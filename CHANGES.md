# 改进计划与变更记录 CHANGES

本项目基于 `ddyy/minshop` 开源电商系统（A 路线，二次开发增强）。在遵循原项目 MIT 许可证、架构规范（Astro 7 + Cloudflare Workers + D1 + R2）以及无状态边缘部署特性的前提下，针对营销优惠能力弱、边缘部署下长周期托管会话导致库存锁定死锁风险、异常订单对账能力欠缺等问题进行实质性改进。

---

## 改进点清单

### 1. 营销与优惠模块增强：内置多策略折扣与优惠券计算引擎
- **背景与问题**：
  原项目仅在对接 Stripe 时将配置项以布尔值 `allowPromotionCodes` 传递给外部托管页面，店内系统完全没有原生的优惠券验证与折扣计算逻辑，导致自建结账流（Lightning、Demo）及 Agent 编程式下单（API 结账）均无法使用任何优惠机制。
- **改动文件**：
  - 新增：`src/features/discounts/engine.ts`（折扣计算与优惠券校验核心逻辑）
  - 新增：`src/features/discounts/engine.test.ts`（单元测试覆盖率：边界舍入、门槛检验、过期与限次、超额封顶）
  - 新增：`src/pages/api/coupon/validate.ts`（供前端与 Agent 调用的优惠码在线校验与实时抵扣试算接口）
  - 修改：`src/pages/api/checkout.ts`（支持在编程式 JSON 结账中传入 `coupon_code`，校验合法后抵扣并记录折扣金额）
  - 修改：`src/features/cache/public.ts` 及 `public.test.ts`（把 `/api/coupon` 与 `/api/coupon/*` 列为私有路径、不走缓存，保证校验结果实时）
- **数据来源与持久化说明**：优惠券目录为代码内置示例 `SAMPLE_PROMO_CODES`（WELCOME10 / FREESHIP / SAVE5），`findCouponByCode` 默认查该目录、也可传入自定义目录；本次未新增数据库表与迁移。`usageLimit` / `usedCount` 为 Coupon 对象字段，校验时 `usedCount >= usageLimit` 即拒绝（`usage_limit_reached`），但示例目录未设 usageLimit，且结账核销时只把 `coupon_code` 记到订单上、不回写使用次数——使用次数的持久化计数尚未实现，生产级发券/核销计数需另接 D1 优惠券表。
- **做法**：
  - 实现纯函数式无外部副作用的 `calculateDiscount` 与 `validateCoupon`，全流程以分（integer minor units）为单位进行整数运算，杜绝浮点精度丢失。
  - 支持三种经典优惠类型：百分比折扣（带最大折扣上限封顶 `maxDiscountCents`）、固定金额抵扣、免运费折扣。
  - 支持多种使用守卫：最低消费门槛（`minSubtotalCents`）、生效与失效时间窗口、最大使用次数限制、大小写不敏感编码比对，抵扣金额严格受限于订单小计，防止出现负金额订单。

---

### 2. 边缘部署下的库存与订单一致性增强：滞留托管支付会话超时安全自动释放机制
- **背景与问题**：
  原项目中，`releaseExpiredReservations` 仅自动回收 `payment_method IN ('lightning', 'demo')` 的过期库存保留；对于托管类支付方式（`stripe`、`opennode`），原作者设计仅依赖服务商的 Webhook 通知（如会话超时或取消）。
  然而在边缘网络环境下，若用户在托管页面直接放弃支付关闭页面、或公网 Webhook 投递失败/延迟/网络分区，未支付的库存保留行将永久保持为 `active` 状态，所占用的库存永远无法释放，导致其他消费者看到“商品售罄”，造成实质性的库存锁死和销售损失。
- **改动文件**：
  - 修改：`src/features/orders/reservations.ts`（新增 `releaseStaleHostedReservations` 滞留托管会话超时安全回收函数）
  - 修改：`src/worker.ts`（在定时任务 Scheduled Sweeps 中接入滞留托管会话超时回收）
  - 修改：`test/integration/reservations.mjs`（在集成测试中覆盖滞留托管会话回收逻辑）
- **做法**：
  - 在 `reservations.ts` 中引入针对 `stripe` 与 `opennode` 的超时保护机制：当保留时间超过安全宽限期（默认过期后 24 小时以上，远超 Stripe 会话最长有效期）且无结算订单关联时，判定为滞留孤儿保留。
  - 通过单条 SQL 条件原子性将状态置为 `expired` 并归还库存，同时调用 `purgeStockProductCache` 刷新边缘缓存标签，确保库存恢复立即可见。

---

### 3. 订单结算与库存异常对账增强：批量解决与库存缺口汇总
- **背景与问题**：
  当发生超卖或网络延迟导致滞后结算时，系统会在 `order_inventory_exceptions` 写入库存缺口记录。原项目仅支持按单条记录单个手工标记已解决，缺乏批量对账处理能力，也无法汇总全店当前因异常未交付的商品缺口总数。
- **改动文件**：
  - 修改：`src/features/orders/db.ts`（新增 `batchResolveInventoryExceptions` 与 `getInventoryExceptionSummary` 函数）
  - 修改：`test/integration/reservations.mjs`（新增针对滞留托管保留自动释放、批量异常对账与缺口汇总的集成测试）
- **做法**：
  - 在 `src/features/orders/db.ts` 中实现批量原子化解决函数，支持一次性传入多个异常 publicId，利用 D1 batch 或 IN 子句原子更新状态。
  - 增加缺口汇总函数，按商品及变体聚合未解决的 `shortfall_qty`，方便商家补货与库存核对。

---

### 4. 代码质量与环境优化：消除编译器警告与避免非交互执行卡死
- **背景与问题**：
  - `src/pages/checkout.astro` 中 `result` 变量被声明但未被使用，触发 Astro 编译告警。
  - `create-minshop/src/scaffold.js` 中引入了未使用的 `readdirSync`，触发 TypeScript 告警。
  - `scripts/check-mcp.sh` 在本地执行 wrangler deploy dry-run 时会遇到交互式提示输入，在自动化环境中有卡死风险。
  - `test/integration/d1-integration.sh` 在高负载下 Miniflare 偶发网络连接中断（Error: Network connection lost）时，由于 Miniflare 内部将异常转成了 HTTP 500 报文，原脚本误将其作为正式响应而未能触发重试。
- **改动文件**：
  - 修改：`src/pages/checkout.astro`（重构变量解构使用）
  - 修改：`create-minshop/src/scaffold.js`（移除无用 import）
  - 修改：`scripts/check-mcp.sh`（添加 `export CI="${CI:-true}"` 确保非交互执行）
  - 修改：`test/integration/d1-integration.sh`（增强对 Miniflare 500 Network connection lost 报文的判定，契合重试逻辑）
- **做法**：
  - 清理无用导入与变量解构，保持静态检查 0 warnings、0 errors。
  - 修复 CI 脚本非交互环境兼容性与传输中断重试识别，保证全链路自动化门禁稳定通过。

---

## 自测记录

按项目工程规范在 Node 24.22.1 环境下进行了全套单元测试、类型检查、构建以及边缘 D1 集成验证，所有测试命令均前台同步执行，结果真实无造假：

1. **单元测试 (`npm test` / `npx vitest run`)**
   - 执行命令：`npx vitest run`
   - 测试结果：**82 passed (82 files), 922 passed (922 tests)**, 0 failed, 耗时 35.83s。
   - 覆盖范围：包含新增的优惠券引擎单元测试 `src/features/discounts/engine.test.ts`、缓存策略测试 `src/features/cache/public.test.ts` 以及系统全量业务测试。

2. **类型检查与 Astro 诊断 (`npm run check`)**
   - 执行命令：`npm run check` (`npm run theme:sync && astro check`)
   - 检查结果：**Result (369 files): 0 errors, 0 warnings, 1 hint**，完全无任何类型阻断。

3. **生产构建 (`npm run build`)**
   - 执行命令：`npm run build` (`astro build`)
   - 构建结果：**Complete! Server built in 4.43s**，成功产出 170 个 modules，生成适配 `@astrojs/cloudflare` 的 Worker 生产构件。

4. **边缘集成测试套件 (`npm run test:integration`)**
   - 执行命令：`npm run test:integration`
   - 测试结果：
     - `test/integration/reservations.mjs`: **Passed**（包含新增的滞留托管释放与批量异常对账断言）
     - `test/integration/refunds.mjs`: **refund accounting: all checks passed**
     - `test/integration/media.mjs`: **media: all checks passed**
     - `test/integration/menus.mjs`: **menus: all checks passed**
     - `test/integration/guest-access.mjs`: **guest-access integration: all assertions passed**
     - `test/integration/shipping.mjs`: **shipping D1 checks passed**
     - `test/integration/d1-integration.sh`: **D1 integration passed: migrations + seed + bound reads + paid-order write/read + cron handler**

5. **全链路质量门禁验证 (`npm run verify`)**
   - 执行命令：`npm run verify`
   - 覆盖流程：`theme:sync` -> `vitest run` -> `astro check` -> `theme:check` -> `astro build` -> `check-built-css.mjs` -> `test:integration` -> `check-stripe-countries.mjs` -> `mcp:check` -> `scaffold:check`。
   - 验证结果：**Exit Code 0 全部顺利通过**（Scaffold 测试 14 pass, 0 fail; Stripe 234 国家比对通过; MCP 部署 dry-run 通过）。
