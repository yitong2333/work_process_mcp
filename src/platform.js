const DEFAULT_BASE_URL = "http://112.53.80.34:8100";
const sessionCookies = new Map();
let sessionOrigin;
let authenticationPromise;

function getConfig() {
  const baseUrl = (process.env.WORK_REPORT_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const parsedBaseUrl = new URL(baseUrl);

  if (!new Set(["http:", "https:"]).has(parsedBaseUrl.protocol)) {
    throw new Error("WORK_REPORT_BASE_URL 仅支持 http 或 https 地址。");
  }

  const username = process.env.WORK_REPORT_USERNAME?.trim();
  const password = process.env.WORK_REPORT_PASSWORD;

  if (!username || !password) {
    throw new Error(
      "未配置平台账号。请在运行 MCP 服务的本机进程中设置 WORK_REPORT_USERNAME 和 WORK_REPORT_PASSWORD。",
    );
  }

  if (/[\r\n]/.test(username) || /[\r\n]/.test(password)) {
    throw new Error("平台账号和密码不能包含换行符。");
  }

  return {
    baseUrl,
    origin: parsedBaseUrl.origin,
    username,
    password,
    timeoutMs: Number(process.env.WORK_REPORT_REQUEST_TIMEOUT_MS || 15000),
    dailyListPath: process.env.WORK_REPORT_DAILY_LIST_PATH || "/report/my/list",
    dailySavePath: process.env.WORK_REPORT_DAILY_SAVE_PATH || "/report/my/save",
    weeklySavePath: process.env.WORK_REPORT_WEEKLY_SAVE_PATH || "/report/weekly/save",
    dailyStartParam: process.env.WORK_REPORT_DAILY_START_PARAM || "beginDate",
    dailyEndParam: process.env.WORK_REPORT_DAILY_END_PARAM || "endDate",
  };
}

function resolveEndpoint(config, path) {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("接口路径必须是以单个斜杠开头的站内路径。");
  }

  const endpoint = new URL(path, config.origin);
  if (endpoint.origin !== config.origin) {
    throw new Error("接口路径不能指向平台以外的地址。");
  }
  return endpoint;
}

function formBody(values) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null) {
      body.set(key, String(value));
    }
  }
  return body;
}

function cookieHeader(url) {
  const now = Date.now();
  const host = url.hostname.toLowerCase();
  const matching = [];

  for (const [key, cookie] of sessionCookies) {
    if (cookie.expiresAt !== undefined && cookie.expiresAt <= now) {
      sessionCookies.delete(key);
      continue;
    }

    const domainMatches = host === cookie.domain || host.endsWith(`.${cookie.domain}`);
    const pathMatches = cookie.path.endsWith("/")
      ? url.pathname.startsWith(cookie.path)
      : url.pathname === cookie.path || url.pathname.startsWith(`${cookie.path}/`);
    const secureMatches = !cookie.secure || url.protocol === "https:";
    if (domainMatches && pathMatches && secureMatches) {
      matching.push(`${cookie.name}=${cookie.value}`);
    }
  }

  return matching.join("; ");
}

function rememberCookies(headers, origin) {
  const responseCookies = headers.getSetCookie?.() ?? [];
  const requestUrl = new URL(origin);

  for (const header of responseCookies) {
    const [cookiePair, ...attributeParts] = header.split(";");
    const separator = cookiePair.indexOf("=");
    if (separator <= 0) continue;

    const name = cookiePair.slice(0, separator).trim();
    const value = cookiePair.slice(separator + 1).trim();
    const attributes = new Map();
    for (const part of attributeParts) {
      const attributeSeparator = part.indexOf("=");
      const key = (attributeSeparator < 0 ? part : part.slice(0, attributeSeparator))
        .trim()
        .toLowerCase();
      const attributeValue = attributeSeparator < 0 ? "" : part.slice(attributeSeparator + 1).trim();
      attributes.set(key, attributeValue);
    }

    const domain = (attributes.get("domain") || requestUrl.hostname).replace(/^\./, "").toLowerCase();
    const responsePath = attributes.get("path") || "/";
    const path = responsePath.startsWith("/") ? responsePath : "/";
    const key = `${domain}|${path}|${name}`;
    const maxAge = attributes.has("max-age") ? Number(attributes.get("max-age")) : undefined;
    const expiresValue = attributes.get("expires");
    const expiresAt = maxAge !== undefined
      ? Date.now() + maxAge * 1000
      : expiresValue
        ? Date.parse(expiresValue)
        : undefined;

    if (maxAge === 0 || (expiresAt !== undefined && expiresAt <= Date.now()) || value === "") {
      sessionCookies.delete(key);
      continue;
    }

    sessionCookies.set(key, {
      name,
      value,
      domain,
      path,
      secure: attributes.has("secure"),
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : undefined,
    });
  }
}

function clearSession() {
  sessionCookies.clear();
}

async function fetchLogin(config) {
  const loginPageUrl = new URL("/login", config.origin);
  const pageResponse = await fetch(loginPageUrl, {
    headers: { Accept: "text/html, */*; q=0.01" },
    redirect: "manual",
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  rememberCookies(pageResponse.headers, config.origin);

  if (!pageResponse.ok || pageResponse.status >= 300) {
    throw new Error(`无法打开平台登录页（HTTP ${pageResponse.status}）。`);
  }

  const loginPage = await pageResponse.text();
  if (/captchaEnabled\s*=\s*true/i.test(loginPage)) {
    throw new Error("平台当前启用了验证码，自动登录已停止；请先在浏览器完成验证后再重试。");
  }

  const loginUrl = new URL("/login", config.origin);
  const headers = {
    Accept: "application/json, text/javascript, */*; q=0.01",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
    Referer: loginPageUrl.toString(),
  };
  const cookies = cookieHeader(loginUrl);
  if (cookies) headers.Cookie = cookies;

  const response = await fetch(loginUrl, {
    method: "POST",
    headers,
    body: formBody({
      username: config.username,
      password: config.password,
      validateCode: "",
      rememberMe: "false",
    }),
    redirect: "manual",
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  rememberCookies(response.headers, config.origin);

  if (!response.ok || response.status >= 300) {
    throw new Error(`平台登录请求失败（HTTP ${response.status}）。`);
  }

  let loginResult;
  try {
    loginResult = JSON.parse(await response.text());
  } catch {
    throw new Error("平台登录接口返回了无法识别的响应。");
  }

  const message = loginResult?.msg || loginResult?.message || "平台登录失败。";
  if (/验证码|captcha/i.test(message)) {
    throw new Error("平台要求验证码，自动登录已停止；请先在浏览器完成验证后再重试。");
  }

  const code = loginResult?.code;
  if (![0, 200, "0", "200"].includes(code)) {
    throw new Error(`平台登录失败：${message}`);
  }

  if (!cookieHeader(new URL("/report/my/list", config.origin))) {
    throw new Error("平台已返回登录成功，但没有收到会话 Cookie，无法继续调用接口。");
  }

  sessionOrigin = config.origin;
}

async function authenticate(config, force = false) {
  if (authenticationPromise) return authenticationPromise;

  authenticationPromise = (async () => {
    if (force || sessionOrigin !== config.origin) {
      clearSession();
      sessionOrigin = undefined;
    }
    if (sessionOrigin === config.origin && cookieHeader(new URL("/report/my/list", config.origin))) return;
    await fetchLogin(config);
  })();

  try {
    await authenticationPromise;
  } finally {
    authenticationPromise = undefined;
  }
}

function isLoginExpired(response, responseText, config) {
  if (response.status === 401 || response.status === 403) return true;

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location") || "";
    return location.toLowerCase().includes("login");
  }

  if (/<html[\s>]/i.test(responseText) && /name=["']username["']/i.test(responseText)) return true;

  try {
    const data = JSON.parse(responseText);
    const code = Number(data?.code);
    const message = String(data?.msg || data?.message || "");
    return [401, 403].includes(code) || /未登录|登录失效|会话过期|登录超时|请先登录|重新登录|认证失败/i.test(message);
  } catch {
    return responseText.includes(`${config.origin}/login`);
  }
}

async function request(path, { method = "GET", query, form, json } = {}) {
  const config = getConfig();
  const endpoint = resolveEndpoint(config, path);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      endpoint.searchParams.set(key, String(value));
    }
  }

  await authenticate(config);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const headers = {
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      Referer: `${config.origin}/`,
    };
    const cookies = cookieHeader(endpoint);
    if (cookies) headers.Cookie = cookies;
    if (json) headers["Content-Type"] = "application/json;charset=UTF-8";
    else if (form) headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";

    const response = await fetch(endpoint, {
      method,
      headers,
      body: json ? JSON.stringify(json) : form ? formBody(form) : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    rememberCookies(response.headers, config.origin);
    const responseText = await response.text();

    if (isLoginExpired(response, responseText, config)) {
      if (attempt === 0) {
        await authenticate(config, true);
        continue;
      }
      throw new Error("平台登录态刷新后仍无法访问接口，请检查账号密码和账号权限。");
    }

    if (response.status >= 300 && response.status < 400) {
      throw new Error(`平台接口返回了未预期的重定向（HTTP ${response.status}）。`);
    }
    if (!response.ok) {
      throw new Error(`平台请求失败（HTTP ${response.status}）：${responseText.slice(0, 300)}`);
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      if (/<html[\s>]/i.test(responseText)) {
        throw new Error("平台接口返回了网页而非 JSON；请核对接口路径和账号权限。");
      }
      throw new Error("平台返回的内容不是 JSON；请核对接口路径和平台版本。");
    }

    const code = data && typeof data === "object" ? data.code : undefined;
    if (code !== undefined && ![0, 200, "0", "200"].includes(code)) {
      const message = data.msg || data.message || `业务状态码 ${code}`;
      throw new Error(`平台接口返回失败：${message}`);
    }

    return data;
  }

  throw new Error("平台登录态刷新失败，请稍后重试。");
}

function getRows(data) {
  const candidates = [
    data,
    data?.rows,
    data?.data,
    data?.data?.rows,
    data?.data?.list,
    data?.list,
    data?.records,
    data?.data?.records,
  ];
  const rows = candidates.find(Array.isArray);
  if (!rows) {
    throw new Error("日报列表接口返回结构无法识别；请核对 WORK_REPORT_DAILY_LIST_PATH。");
  }
  return rows;
}

function getTotal(data) {
  const total = data?.total ?? data?.data?.total;
  const parsed = Number(total);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function pick(row, names) {
  for (const name of names) {
    if (row?.[name] !== undefined && row[name] !== null && row[name] !== "") {
      return row[name];
    }
  }
  return undefined;
}

function normalizeDailyReport(row) {
  const date = pick(row, ["reportDate", "date", "dailyDate", "workDate", "day"]);
  const status = pick(row, ["statusName", "statusText", "reportStatusName", "status"]);
  const source = pick(row, ["sourceName", "sourceText", "backfillFlag", "source"]);
  const late = pick(row, ["lateText", "lateFlag", "isLate", "late"]);
  return {
    date,
    filled: true,
    status: { "0": "草稿", "1": "已提交" }[status] ?? status,
    source: { "0": "正常", "1": "补填" }[source] ?? source,
    work_hours: pick(row, ["workHours", "hours"]),
    submitted_at: pick(row, ["submitTime", "submittedAt", "submitDate"]),
    late: { "0": "按时", "1": "迟交" }[late] ?? late,
    completed: pick(row, ["summary", "content", "workSummary"]),
    blockers: pick(row, ["issues", "blockers", "risk"]),
    next_plan: pick(row, ["planTomorrow", "nextPlan", "plan"]),
  };
}

export async function listDailyReports(startDate, endDate) {
  const config = getConfig();
  const pageSize = 1000;
  const collectedRows = [];
  let data;

  for (let pageNum = 1; pageNum <= 100; pageNum += 1) {
    data = await request(config.dailyListPath, {
      method: "POST",
      form: {
        [config.dailyStartParam]: startDate,
        [config.dailyEndParam]: endDate,
        pageNum,
        pageSize,
      },
    });

    const pageRows = getRows(data);
    collectedRows.push(...pageRows);
    const total = getTotal(data);

    if (total !== undefined && collectedRows.length >= total) break;
    if (pageRows.length < pageSize) break;
    if (pageNum === 100) {
      throw new Error("日报查询结果超过 100000 条，请缩小日期范围后重试。");
    }
  }

  const rows = collectedRows.map(normalizeDailyReport);

  return {
    start_date: startDate,
    end_date: endDate,
    count: rows.length,
    reports: rows,
  };
}

export async function saveDailyReport(date, completed, blockers, nextPlan) {
  const config = getConfig();
  const data = await request(config.dailySavePath, {
    method: "POST",
    query: { submit: 0 },
    json: {
      reportId: null,
      reportDate: date,
      workHours: 8,
      summary: completed,
      issues: blockers,
      planTomorrow: nextPlan,
      itemList: [],
    },
  });

  return {
    date,
    status: "draft",
    work_hours: 8,
    message: data.msg || data.message || "日报草稿已保存。",
  };
}

export async function saveWeeklyReport(weekStart, achievements, nextPlan) {
  const config = getConfig();
  const reportDate = new Date(`${weekStart}T00:00:00.000Z`);
  reportDate.setUTCDate(reportDate.getUTCDate() + 4);
  const friday = reportDate.toISOString().slice(0, 10);

  const data = await request(config.weeklySavePath, {
    method: "POST",
    form: {
      weeklyId: "",
      weekStartDate: weekStart,
      weekPick: weekStart,
      content: achievements,
      plan: nextPlan,
      issues: "",
    },
  });

  return {
    week_start: weekStart,
    report_date: friday,
    message: data.msg || data.message || "周报已保存。",
  };
}
