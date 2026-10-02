# mod.io CLI

用于从终端创建和维护 mod.io Mods、发布 ZIP modfile，以及维护 Collection 模组包清单。CLI 使用 mod.io 官方 REST API，不读取浏览器 Cookie。

## 要求

- Node.js 20 或更高版本
- mod.io 游戏的 `game-id` 和 API Key

## 安装

```sh
npm install -g .
modio --help
```

## 配置与登录

```sh
modio config set game-id 123456
modio config set api-key YOUR_GAME_API_KEY
modio auth login you@example.com
```

CLI 会向邮箱发送安全码，输入后保存 OAuth access token 与 refresh token。令牌、API Key 和 game ID 保存在 `~/.config/modio-cli/config.json`；配置目录权限为 `700`，配置文件权限为 `600`。`XDG_CONFIG_HOME` 可更改配置根目录。

也可以导入已有令牌：

```sh
MODIO_ACCESS_TOKEN='...' MODIO_REFRESH_TOKEN='...' modio auth set-token
```

查看配置与登录状态时不会输出密钥或令牌：

```sh
modio config get
modio auth status
modio whoami
modio auth logout
```

`MODIO_GAME_ID`、`MODIO_API_KEY`、`MODIO_ACCESS_TOKEN` 和 `MODIO_REFRESH_TOKEN` 环境变量可覆盖或补充配置。已保存到本地的令牌优先于令牌环境变量，以便刷新后继续复用新令牌。

## 认证与回退

- 读取请求优先使用 OAuth Bearer token；token 无效时可用 API Key 重试 GET 请求。
- 写入和上传必须有有效 OAuth token；API Key 不会作为写操作的回退凭据。
- API Key 用于读取以及通过邮件验证码取得用户 token。Cookie 登录未实现，因为 mod.io 官方 REST API 文档未将网站 Cookie 定义为 API 认证方式。
- Email 验证码是 mod.io 官方支持的用户认证流程；官方将其描述为便于测试的方式，不推荐用于游戏正式上线。此 CLI 使用它为开发者工具登录；具体账号仍须有权管理目标内容。

## Mods

```sh
modio mod list --limit 20
modio mod get 123
modio mod create --name "Example Mod" --summary "Short summary" --logo ./logo.png
modio mod update 123 --summary "Updated summary" --description "Long description"
```

创建 Mod 时需要提供 Logo。新建 Mod 后还需要上传 modfile；游戏的审核与接受状态由 mod.io 游戏管理员权限决定。

## modfile 发布

```sh
modio modfile upload 123 ./release.zip --version 1.2.0 --changelog "修复问题并更新内容"
modio modfile update 123 456 --version 1.2.1 --changelog "更新说明"
modio modfile activate 123 456
```

`upload` 创建新 modfile；`update` 修改现有文件版本信息；`activate` 将文件设为当前 active 版本。普通上传最大支持 500 MB，超过 100 MB 时 mod.io 建议使用分片上传；本 CLI 当前使用普通上传请求，并会将 ZIP 载入内存后上传。

## Collection 模组包

mod.io 的 Collection 是一组已发布 Mod 的清单，不是 ZIP 文件。可通过 `--mod-ids` 传入逗号分隔的 Mod ID：

```sh
modio collection create --name "My Modpack" --summary "精选模组" --mod-ids 123,456
modio collection list --limit 20
modio collection get 789
modio collection mods 789
modio collection add-mods 789 --mod-ids 555,666
modio collection remove-mods 789 --mod-ids 555
modio collection update 789 --name "Updated Modpack"
```

更新 Collection 的成员列表会先读取现有成员并合并新增 ID；移除成员使用 mod.io 的 Collection Mods 删除接口。

## 常用环境变量

```sh
export MODIO_GAME_ID=123456
export MODIO_API_KEY=YOUR_GAME_API_KEY
```

获取令牌后即可在脚本或 CI 中运行支持的 CLI 命令。不要将 API Key、access token 或 refresh token 提交到仓库。

## 官方 API 依据

- [REST API 认证与请求](https://docs.mod.io/restapi/introduction#making-requests)
- [请求 Email 安全码](https://docs.mod.io/restapi/docs/request-email-security-code)
- [用 Email 安全码换取 token](https://docs.mod.io/restapi/docs/exchange-email-security-code)
- [认证与 refresh token](https://docs.mod.io/authentication)
- [创建 Mod](https://docs.mod.io/restapi/docs/add-mod)
- [上传 modfile](https://docs.mod.io/restapi/docs/add-modfile)
- [创建 Collection](https://docs.mod.io/restapi/docs/add-collection)
