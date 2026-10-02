import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";

const configRoot = await mkdtemp(path.join(os.tmpdir(), "modio-cli-test-"));
process.env.XDG_CONFIG_HOME = configRoot;
for (const key of ["MODIO_GAME_ID", "MODIO_API_KEY", "MODIO_ACCESS_TOKEN", "MODIO_REFRESH_TOKEN"]) {
    delete process.env[key];
}

const { ModioApi } = await import("../src/api.js");
const { readConfig, writeConfig } = await import("../src/config.js");
const api = new ModioApi();
let originalFetch;

before(() => {
    originalFetch = globalThis.fetch;
});

beforeEach(async () => {
    globalThis.fetch = originalFetch;
    await writeConfig({ gameId: "123", apiKey: "game-key" });
});

after(async () => {
    globalThis.fetch = originalFetch;
    await rm(configRoot, { recursive: true, force: true });
});

test("API Key 可执行只读请求", async () => {
    let requestUrl;
    let requestHeaders;
    globalThis.fetch = async (url, options) => {
        requestUrl = new URL(url);
        requestHeaders = options.headers;
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
    };

    await api.request("GET", "/games/123/mods");

    assert.equal(requestUrl.searchParams.get("api_key"), "game-key");
    assert.equal(requestHeaders.Authorization, undefined);
});

test("没有 OAuth token 时会在本地拒绝写操作", async () => {
    let called = false;
    globalThis.fetch = async () => {
        called = true;
        return new Response("{}", { status: 200 });
    };

    await assert.rejects(
        api.request("POST", "/games/123/mods", { form: { name: "test" } }),
        /需要 OAuth access token/,
    );
    assert.equal(called, false);
});

test("Bearer token 读取遇到 401 后才回退到 API Key", async () => {
    await writeConfig({
        gameId: "123",
        apiKey: "game-key",
        accessToken: "expired-token",
    });
    const requests = [];
    globalThis.fetch = async (url, options) => {
        requests.push({ url: new URL(url), headers: options.headers });
        if (requests.length === 1) return new Response(JSON.stringify({ error: "invalid token" }), { status: 401 });
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
    };

    await api.request("GET", "/games/123/mods");

    assert.equal(requests.length, 2);
    assert.equal(requests[0].headers.Authorization, "Bearer expired-token");
    assert.equal(requests[0].url.searchParams.has("api_key"), false);
    assert.equal(requests[1].headers.Authorization, undefined);
    assert.equal(requests[1].url.searchParams.get("api_key"), "game-key");
});

test("刷新令牌会轮换并保存新 access/refresh token", async () => {
    await writeConfig({
        gameId: "123",
        apiKey: "game-key",
        accessToken: "old-token",
        refreshToken: "old-refresh",
        tokenExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const requests = [];
    globalThis.fetch = async (url, options) => {
        requests.push({ url: new URL(url), options });
        if (requests.length === 1) {
            return new Response(JSON.stringify({
                access_token: "new-token",
                refresh_token: "new-refresh",
                date_expires: Math.floor(Date.now() / 1000) + 3600,
            }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
    };

    await api.request("GET", "/games/123/mods");

    assert.equal(requests.length, 2);
    assert.equal(requests[0].url.pathname, "/v1/oauth/token");
    assert.equal(requests[0].url.searchParams.has("api_key"), false);
    assert.equal(requests[1].options.headers.Authorization, "Bearer new-token");
    const config = await readConfig();
    assert.equal(config.accessToken, "new-token");
    assert.equal(config.refreshToken, "new-refresh");
});
