# solarglyph-core — 仿真服务（源）

这个目录是**源**。技能包里那份 `skills/solar-glyph-simulation/solarglyph-core/` 是
安装时用的**副本**，由 `npm run sync-skill` 从本目录复制过去，两者必须逐字节一致。

```
solarglyph-core/engine.js     光伏发电与余热回收的计算内核
solarglyph-core/presets.js    四个内置场景 + 余热源库
solarglyph-core/server.js     HTTP 任务接口（默认 127.0.0.1:8787）
```

## 为什么不能删

- `npm start` 与本目录绑定（`node solarglyph-core/server.js`）。
- `npm run verify-skill` 用**本目录**作为参照，校验技能副本没有被手改。
- `docs/deployment.md` 与 README 的部署步骤都指向这里。

删掉本目录会让这三处同时失效——技能本身还能跑（它自带副本），但仓库的
启动命令和自检会报 `ENOENT`，评委按文档操作会直接失败。

## 常用命令

```bash
npm start              # 启动服务
npm run sync-skill     # 把源同步进技能副本
npm run verify-skill   # 校验副本与源一致 + 端到端自检
npm run check          # verify-skill + smoke
```
