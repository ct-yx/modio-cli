import { getSettings, updateConfig } from "./config.js";

export class ApiError extends Error {
    constructor(status, payload, url) {
        const message = payload?.error_description || payload?.message || payload?.error || `HTTP ${status}`;
        super(`mod.io 返回 ${status}: ${message}`);
        this.name = "ApiError";
        this.status = status;
        this.payload = payload;
        this.url = url;
    }
}

function apiBase(gameId) {
    if (!gameId) throw new Error("缺少 game-id。先运行 `modio config set game-id <id>`。");
    return `https://g-${encodeURIComponent(gameId)}.modapi.io/v1`;
}

async function parseResponse(response, url) {
    const text = await response.text();
    let payload = null;
    if (text) {
        try {
            payload = JSON.parse(text);
        } catch {
            payload = { message: text };
        }
    }
    if (!response.ok) throw new ApiError(response.status, payload, url);
    return payload;
}

export class ModioApi {
    async settings() {
        const settings = await getSettings();
        if (!settings.gameId) throw new Error("缺少 game-id。先运行 `modio config set game-id <id>`。");
        return settings;
    }

    async request(method, endpoint, { query = {}, form, file, auth = true } = {}) {
        const settings = await this.settings();
        const urlBase = apiBase(settings.gameId);
        const url = new URL(`${urlBase}${endpoint}`);
        for (const [key, value] of Object.entries(query)) {
            if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
        }

        let token = auth ? settings.accessToken : null;
        if (auth && !token && !settings.apiKey) {
            throw new Error("需要 API Key 或 OAuth token。使用 `modio auth login` 登录，或配置 MODIO_API_KEY。");
        }
        if (auth && method !== "GET" && !token) {
            throw new Error("此操作需要 OAuth access token。运行 `modio auth login`，或使用 `modio auth set-token`。");
        }
        if (token && settings.refreshToken && settings.tokenExpiresAt && Date.parse(settings.tokenExpiresAt) <= Date.now() + 60_000) {
            try {
                token = await this.refreshToken(settings);
            } catch (error) {
                if (method !== "GET" || !settings.apiKey) throw error;
                token = null;
            }
        }
        const useToken = Boolean(auth && token);
        try {
            return await this.requestOnce(method, url, { form, file, token: useToken ? token : null, apiKey: useToken ? null : settings.apiKey });
        } catch (error) {
            if (!(error instanceof ApiError) || error.status !== 401 || !auth) throw error;

            let retryUnauthorized = true;
            if (token && settings.refreshToken) {
                try {
                    token = await this.refreshToken(settings);
                    return await this.requestOnce(method, url, { form, file, token, apiKey: null });
                } catch (retryError) {
                    error = retryError;
                    retryUnauthorized = retryError instanceof ApiError && retryError.status === 401;
                }
            }

            if (retryUnauthorized && method === "GET" && settings.apiKey && token) {
                return this.requestOnce(method, url, { form, file, token: null, apiKey: settings.apiKey });
            }
            throw error;
        }
    }

    async requestOnce(method, url, { form, file, token, apiKey }) {
        const requestUrl = new URL(url);
        if (apiKey) requestUrl.searchParams.set("api_key", apiKey);
        const headers = {};
        if (token) headers.Authorization = `Bearer ${token}`;

        let body;
        if (file) {
            const multipart = new FormData();
            for (const [key, value] of Object.entries(form || {})) {
                if (value !== undefined && value !== null) multipart.append(key, String(value));
            }
            multipart.append(file.fieldName || "filedata", new Blob([file.buffer]), file.name);
            body = multipart;
        } else if (form) {
            body = new URLSearchParams();
            for (const [key, value] of Object.entries(form)) {
                if (value !== undefined && value !== null) body.set(key, Array.isArray(value) ? value.join(",") : String(value));
            }
            headers["Content-Type"] = "application/x-www-form-urlencoded";
        }

        const response = await fetch(requestUrl, { method, headers, body });
        return parseResponse(response, requestUrl.toString());
    }

    async refreshToken(settings) {
        if (!settings.refreshToken) return null;
        const url = new URL(`${apiBase(settings.gameId)}/oauth/token`);
        const body = new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: settings.refreshToken,
        });
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body,
        });
        const payload = await parseResponse(response, url.toString());
        await saveTokenPayload(payload);
        if (process.env.MODIO_ACCESS_TOKEN) process.env.MODIO_ACCESS_TOKEN = payload.access_token;
        if (payload.refresh_token && process.env.MODIO_REFRESH_TOKEN) process.env.MODIO_REFRESH_TOKEN = payload.refresh_token;
        return payload.access_token;
    }
}

export async function saveTokenPayload(payload) {
    if (!payload?.access_token) throw new Error("mod.io 响应中没有 access_token。");
    const rawExpiry = payload.date_expires;
    const expiresAt = rawExpiry
        ? (/^\d+$/.test(String(rawExpiry))
            ? new Date(Number(rawExpiry) * 1000).toISOString()
            : new Date(rawExpiry).toISOString())
        : (payload.expires_in ? new Date(Date.now() + Number(payload.expires_in) * 1000).toISOString() : undefined);
    await updateConfig({
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token || null,
        tokenExpiresAt: expiresAt || null,
    });
}
