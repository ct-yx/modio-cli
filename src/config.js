import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const configDir = path.join(
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
    "modio-cli",
);
export const configPath = path.join(configDir, "config.json");

export async function readConfig() {
    try {
        return JSON.parse(await readFile(configPath, "utf8"));
    } catch (error) {
        if (error.code === "ENOENT") return {};
        throw new Error(`无法读取配置文件 ${configPath}: ${error.message}`);
    }
}

export async function writeConfig(config) {
    await mkdir(configDir, { recursive: true, mode: 0o700 });
    await chmod(configDir, 0o700);
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    await chmod(configPath, 0o600);
}

export async function getSettings() {
    const config = await readConfig();
    return {
        gameId: process.env.MODIO_GAME_ID || config.gameId,
        apiKey: process.env.MODIO_API_KEY || config.apiKey,
        accessToken: config.accessToken || process.env.MODIO_ACCESS_TOKEN,
        refreshToken: config.refreshToken || process.env.MODIO_REFRESH_TOKEN,
        tokenExpiresAt: config.tokenExpiresAt,
    };
}

export async function updateConfig(patch) {
    const current = await readConfig();
    await writeConfig({ ...current, ...patch });
}

export async function clearTokens() {
    const config = await readConfig();
    delete config.accessToken;
    delete config.refreshToken;
    delete config.tokenExpiresAt;
    await writeConfig(config);
}
