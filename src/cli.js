#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { ModioApi, saveTokenPayload } from "./api.js";
import { clearTokens, configPath, getSettings, readConfig, updateConfig } from "./config.js";

const api = new ModioApi();

function parseArgs(args) {
    const positionals = [];
    const flags = {};
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (!arg.startsWith("--")) {
            positionals.push(arg);
            continue;
        }
        const equalAt = arg.indexOf("=");
        const key = arg.slice(2, equalAt === -1 ? undefined : equalAt);
        if (equalAt !== -1) {
            flags[key] = arg.slice(equalAt + 1);
        } else if (args[i + 1] && !args[i + 1].startsWith("--")) {
            flags[key] = args[i + 1];
            i += 1;
        } else {
            flags[key] = true;
        }
    }
    return { positionals, flags };
}

function formFields(flags, names) {
    const form = {};
    for (const name of names) {
        if (flags[name] !== undefined) form[name.replaceAll("-", "_")] = flags[name];
    }
    return form;
}

function print(value) {
    output.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function prompt(label) {
    const terminal = readline.createInterface({ input, output });
    try {
        return (await terminal.question(label)).trim();
    } finally {
        terminal.close();
    }
}

async function configure(args) {
    const { positionals } = parseArgs(args);
    const [action, name, value] = positionals;
    if (action === "get") {
        const config = await readConfig();
        const secrets = new Set(["apiKey", "accessToken", "refreshToken"]);
        const visible = Object.fromEntries(Object.entries(config).map(([key, entry]) => [key, secrets.has(key) && entry ? "已配置（隐藏）" : entry]));
        print({ path: configPath, values: visible });
        return;
    }
    if (action === "set" && name && value) {
        const keys = { "game-id": "gameId", "api-key": "apiKey" };
        const configKey = keys[name];
        if (!configKey) throw new Error("支持设置 game-id 和 api-key。");
        await updateConfig({ [configKey]: value });
        output.write(`${name} 已保存到 ${configPath}\n`);
        return;
    }
    if (action === "unset" && name) {
        const keys = { "game-id": "gameId", "api-key": "apiKey" };
        const configKey = keys[name];
        if (!configKey) throw new Error("支持移除 game-id 和 api-key。");
        await updateConfig({ [configKey]: undefined });
        output.write(`${name} 已移除。\n`);
        return;
    }
    throw new Error("用法：modio config get | set <game-id|api-key> <value> | unset <game-id|api-key>");
}

async function authenticate(args) {
    const { positionals } = parseArgs(args);
    const [action, argument, refreshToken] = positionals;
    if (action === "login") {
        const settings = await getSettings();
        if (!settings.apiKey) throw new Error("Email 登录需要先配置游戏 API Key：`modio config set api-key <key>`。");
        const email = argument || await prompt("mod.io 邮箱：");
        await api.request("POST", "/oauth/emailrequest", { auth: false, form: { email } });
        output.write(`安全码已发送到 ${email}。\n`);
        const securityCode = await prompt("输入邮件中的安全码：");
        const payload = await api.request("POST", "/oauth/emailexchange", {
            auth: false,
            form: { email, security_code: securityCode },
        });
        await saveTokenPayload(payload);
        output.write("登录成功，令牌已保存并会在后续命令中复用。\n");
        return;
    }
    if (action === "set-token" && argument) {
        const payload = { access_token: argument };
        if (refreshToken) payload.refresh_token = refreshToken;
        await saveTokenPayload(payload);
        output.write("OAuth 令牌已保存。\n");
        return;
    }
    if (action === "set-token" && process.env.MODIO_ACCESS_TOKEN) {
        const payload = { access_token: process.env.MODIO_ACCESS_TOKEN };
        if (process.env.MODIO_REFRESH_TOKEN) payload.refresh_token = process.env.MODIO_REFRESH_TOKEN;
        await saveTokenPayload(payload);
        output.write("环境变量中的 OAuth 令牌已安全保存到本地配置。\n");
        return;
    }
    if (action === "logout") {
        await clearTokens();
        output.write("本地 OAuth 令牌已清除。\n");
        return;
    }
    if (action === "status") {
        const settings = await getSettings();
        print({
            gameId: settings.gameId || null,
            apiKey: settings.apiKey ? "已配置（隐藏）" : null,
            accessToken: settings.accessToken ? "已配置（隐藏）" : null,
            refreshToken: settings.refreshToken ? "已配置（隐藏）" : null,
            tokenExpiresAt: settings.tokenExpiresAt || null,
        });
        return;
    }
    throw new Error("用法：modio auth login [email] | set-token <access-token> [refresh-token] | status | logout");
}

async function manageMods(args) {
    const { positionals, flags } = parseArgs(args);
    const [action, id] = positionals;
    if (action === "list") {
        const query = {};
        if (flags.limit) query._limit = flags.limit;
        if (flags.offset) query._offset = flags.offset;
        print(await api.request("GET", `/games/${(await api.settings()).gameId}/mods`, { query }));
        return;
    }
    if (action === "get" && id) {
        print(await api.request("GET", `/games/${(await api.settings()).gameId}/mods/${encodeURIComponent(id)}`));
        return;
    }
    if (action === "create") {
        const fields = formFields(flags, ["name", "summary", "description", "homepage", "stock", "visible"]);
        if (!fields.name) throw new Error("mod create 至少需要 --name。");
        if (!flags.logo) throw new Error("创建 mod 需要 --logo <图片文件>。");
        const logo = await readFile(flags.logo);
        print(await api.request("POST", `/games/${(await api.settings()).gameId}/mods`, {
            form: fields,
            file: { fieldName: "logo", name: flags.logo.split(/[\\/]/).pop(), buffer: logo },
        }));
        return;
    }
    if (action === "update" && id) {
        const fields = formFields(flags, ["name", "summary", "description", "homepage", "stock", "visible"]);
        if (Object.keys(fields).length === 0) throw new Error("至少提供一个要修改的字段，例如 --summary。");
        print(await api.request("POST", `/games/${(await api.settings()).gameId}/mods/${encodeURIComponent(id)}`, { form: fields }));
        return;
    }
    throw new Error("用法：modio mod list|get <id>|create --name ...|update <id> --summary ...");
}

async function manageModfiles(args) {
    const { positionals, flags } = parseArgs(args);
    const [action, modId, filePathOrId] = positionals;
    const gameId = (await api.settings()).gameId;
    if (action === "upload" && modId && filePathOrId) {
        const fileStat = await stat(filePathOrId);
        if (!fileStat.isFile()) throw new Error(`不是普通文件：${filePathOrId}`);
        if (fileStat.size > 500 * 1024 * 1024) throw new Error("文件超过 mod.io 普通上传的 500 MB 上限。");
        if (!filePathOrId.toLowerCase().endsWith(".zip")) throw new Error("mod.io modfile 必须是 ZIP 文件。");
        const file = await readFile(filePathOrId);
        const form = formFields(flags, ["version", "changelog", "active", "metadata-blob"]);
        print(await api.request("POST", `/games/${gameId}/mods/${encodeURIComponent(modId)}/files`, {
            form,
            file: { fieldName: "filedata", name: filePathOrId.split(/[\\/]/).pop(), buffer: file },
        }));
        return;
    }
    if (action === "activate" && modId && filePathOrId) {
        print(await api.request("POST", `/games/${gameId}/mods/${encodeURIComponent(modId)}/files/${encodeURIComponent(filePathOrId)}`, { form: { active: true } }));
        return;
    }
    if (action === "update" && modId && filePathOrId) {
        const form = formFields(flags, ["version", "changelog", "active", "metadata-blob"]);
        if (Object.keys(form).length === 0) throw new Error("至少指定 --version、--changelog、--active 或 --metadata-blob 中的一项。");
        print(await api.request("POST", `/games/${gameId}/mods/${encodeURIComponent(modId)}/files/${encodeURIComponent(filePathOrId)}`, { form }));
        return;
    }
    throw new Error("用法：modio modfile upload <mod-id> <file.zip> --version ... --changelog ... | update <mod-id> <file-id> ... | activate <mod-id> <file-id>");
}

async function manageCollections(args) {
    const { positionals, flags } = parseArgs(args);
    const [action, id] = positionals;
    const gameId = (await api.settings()).gameId;
    const base = `/games/${gameId}/collections`;
    if (action === "list") {
        print(await api.request("GET", "/me/collections", { query: { _limit: flags.limit, _offset: flags.offset } }));
        return;
    }
    if (action === "get" && id) {
        print(await api.request("GET", `${base}/${encodeURIComponent(id)}`));
        return;
    }
    if (action === "create") {
        const fields = formFields(flags, ["name", "summary", "description", "visible", "mod-ids"]);
        if (!fields.name) throw new Error("collection create 至少需要 --name。");
        print(await api.request("POST", base, { form: fields }));
        return;
    }
    if (action === "update" && id) {
        const fields = formFields(flags, ["name", "summary", "description", "visible", "mod-ids"]);
        if (Object.keys(fields).length === 0) throw new Error("至少提供一个要修改的字段。");
        print(await api.request("POST", `${base}/${encodeURIComponent(id)}`, { form: fields }));
        return;
    }
    if (action === "mods" && id) {
        print(await api.request("GET", `${base}/${encodeURIComponent(id)}/mods`));
        return;
    }
    if (action === "remove-mods" && id && flags["mod-ids"]) {
        print(await api.request("DELETE", `${base}/${encodeURIComponent(id)}/mods`, { query: { mod_ids: flags["mod-ids"] } }));
        return;
    }
    if (action === "add-mods" && id && flags["mod-ids"]) {
        const ids = [];
        const pageSize = 100;
        for (let offset = 0; ; offset += pageSize) {
            const current = await api.request("GET", `${base}/${encodeURIComponent(id)}/mods`, {
                query: { _limit: pageSize, _offset: offset },
            });
            const rows = Array.isArray(current) ? current : (current?.data || current?.mods || []);
            ids.push(...rows.map((mod) => String(mod.id ?? mod.mod_id)).filter((modId) => modId !== "undefined"));
            if (rows.length < pageSize) break;
        }
        for (const modId of String(flags["mod-ids"]).split(",").map((part) => part.trim()).filter(Boolean)) {
            if (!ids.includes(modId)) ids.push(modId);
        }
        print(await api.request("POST", `${base}/${encodeURIComponent(id)}`, { form: { mod_ids: ids.join(",") } }));
        return;
    }
    throw new Error("用法：modio collection list|get <id>|create --name ...|update <id> --name ...|mods <id>|add-mods <id> --mod-ids 1,2|remove-mods <id> --mod-ids 1,2");
}

function help() {
    output.write(`modio — mod.io 内容管理 CLI\n\n` +
        `配置：\n` +
        `  modio config set game-id <id>\n` +
        `  modio config set api-key <key>\n` +
        `  modio config get\n\n` +
        `认证：\n` +
        `  modio auth login [email]\n` +
        `  modio auth set-token <access-token> [refresh-token]  # 或设置 MODIO_ACCESS_TOKEN 后不带参数\n` +
        `  modio auth status | logout\n` +
        `  modio whoami\n\n` +
        `内容管理：\n` +
        `  modio mod list|get <id>|create --name ... --logo <图片>|update <id> [字段选项]\n` +
        `  modio modfile upload <mod-id> <file.zip> [--version v] [--changelog text]\n` +
        `  modio modfile update <mod-id> <file-id> [字段选项]\n` +
        `  modio modfile activate <mod-id> <file-id>\n` +
        `  modio collection list|get <id>|create|update <id>|mods <id>\n` +
        `  modio collection add-mods|remove-mods <id> --mod-ids 1,2\n\n` +
        `环境变量：MODIO_GAME_ID、MODIO_API_KEY、MODIO_ACCESS_TOKEN、MODIO_REFRESH_TOKEN\n`);
}

async function main() {
    const [command, ...args] = process.argv.slice(2);
    if (!command || command === "--help" || command === "-h" || command === "help") return help();
    if (command === "--version" || command === "-V") {
        const packageInfo = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
        output.write(`${packageInfo.version}\n`);
        return;
    }
    if (command === "config") return configure(args);
    if (command === "auth") return authenticate(args);
    if (command === "whoami") return print(await api.request("GET", "/me"));
    if (command === "mod") return manageMods(args);
    if (command === "modfile") return manageModfiles(args);
    if (command === "collection") return manageCollections(args);
    throw new Error(`未知命令：${command}。运行 modio --help 查看用法。`);
}

main().catch((error) => {
    output.write(`错误：${error.message}\n`);
    process.exitCode = 1;
});
