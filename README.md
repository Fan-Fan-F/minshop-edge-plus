# minshop-edge-plus

> 面向边缘计算与 AI Agent 的轻量级高性能全栈电商系统（基于 Cloudflare Workers + D1 + R2 + Astro SSR 二次开发增强）。  
> Lightweight, high-performance edge ecommerce platform designed for humans and AI agents (built on Astro SSR, Cloudflare Workers, D1, R2, with secondary development enhancements).

---

## 中文文档

### 项目简介

`minshop-edge-plus` 是在开源项目 `minshop` 基础上进行二次开发增强的边缘电商系统。项目架构依托 Cloudflare 边缘技术栈（Astro SSR on Cloudflare Workers + D1 关系型数据库 + R2 零流出存储），具备极低冷启动延迟与极小资源消耗，支持人机协同交互（人类用户通过网页/移动端结账，AI Agent 可通过标准 JSON API 或 MCP 协议自主浏览商品并完成 Lightning 闪电网络支付）。

在此次二次开发中，我们针对原项目在营销促销机制缺失、边缘网络下托管支付会话异常导致库存死锁锁死、库存超卖缺口缺乏批量对账手段等关键痛点进行了实质性扩展与加固。

### 核心功能与增强特性

本项目在继承原项目全部特性的基础上，实现了以下 4 项实质性改进（逐条对应 `CHANGES.md`）：

1. **营销与优惠模块增强：内置多策略折扣与优惠券计算引擎**
   - **内置计算引擎**：引入纯函数式安全计算引擎（`src/features/discounts/engine.ts`），端到端使用整型“分”（minor units）进行货币计算，彻底消除浮点精度损失与负金额风险。
   - **丰富优惠策略**：支持百分比折扣（支持设置单笔最大优惠上限封顶 `maxDiscountCents`）、固定金额减免、免运费等多类型优惠。
   - **严格使用门槛与生命周期**：支持最低消费门槛（`minSubtotalCents`）、生效与过期时间窗口校验、最大使用频次限制及不区分大小写的优惠码比对。
   - **开放式接口与结账集成**：新增公共校验与抵扣试算接口（`/api/coupon/validate`），并在编程式结账（`/api/checkout`）中无缝支持 `coupon_code` 优惠核销。

2. **边缘部署下的库存与订单一致性增强：滞留托管支付会话超时安全自动释放机制**
   - **解决库存锁死痛点**：原项目针对 Stripe/OpenNode 等托管支付仅依赖服务商 Webhook 解锁库存；在边缘网络丢包、延迟或消费者直接关闭页面时，未支付的库存保留行会永久滞留为 `active` 导致商品被永久锁死。
   - **自动孤儿回收**：新增 `releaseStaleHostedReservations` 保护函数，识别超时且无关联订单的滞留保留单，单条 SQL 原子性将其翻转为 `expired` 状态并安全归还物理库存。
   - **Cron 调度集成**：在 Worker 定时扫频任务（Scheduled Sweeps）中自动挂载回收逻辑，并自动联动边缘缓存标签淘汰（`purgeStockProductCache`），确保库存状态即时恢复。

3. **订单结算与库存异常对账增强：批量解决与库存缺口汇总**
   - **批量对账能力**：在 `src/features/orders/db.ts` 中新增 `batchResolveInventoryExceptions`，支持按异常 ID 列表批量完成状态翻转与对账，极大降低商家运维负担。
   - **缺口全局透视**：新增 `getInventoryExceptionSummary` 聚合查询，实时按商品和变体统计当前未解决的缺口数量（`shortfall_qty`），为补货排产提供可靠数据支撑。

4. **代码质量与运行环境健壮性优化**
   - **编译与静态检查零告警**：重构并清理 `src/pages/checkout.astro` 与脚手架 `create-minshop/src/scaffold.js` 中的未使用导入与变量，保持 Astro 诊断与类型检查 0 errors、0 warnings。
   - **CI 与自动化非交互适配**：优化 `scripts/check-mcp.sh` 非交互式环境变量支持，消除自动化构建过程中的交互阻塞。
   - **测试套件网络容错修复**：修复 `test/integration/d1-integration.sh` 在本地高负载下 Miniflare 偶发连接重置误判为正式 500 响应的问题，对齐重试机制，确保全链路门禁执行可靠稳定。

### 快速开始

#### 环境准备
- **Node.js**：≥ 22.12（推荐 Node 22 或 24）
- **Git**

#### 安装与启动

1. **克隆项目并安装依赖**
   ```sh
   git clone <repository_url>
   cd minshop-edge-plus
   npm install
   npm install --prefix mcp
   ```

2. **本地环境与数据库初始化（含种子数据）**
   ```sh
   # 自动生成 .dev.vars、执行 D1 本地迁移并写入初始种子数据
   npm run provision:local -- --seed
   ```

3. **启动本地开发服务器**
   ```sh
   npm run dev
   ```
   访问 `http://localhost:4321` 即可体验商店前台与购物流程。

4. **运行全链路质量验证**
   ```sh
   npm run verify
   ```
   该命令包含单元测试、类型检查、构建、多主题校验、D1 集成测试、MCP 检查及脚手架校验。

### 来源与致谢

本项目基于 [minshop](https://github.com/ddyy/minshop) 二次开发，原项目由 [ddyy](https://github.com/ddyy) 以 MIT 许可证开源。

### 许可证

本项目沿用 MIT 许可证，完整许可证文本请参阅根目录 [LICENSE](LICENSE)。

---

## English Documentation

### Introduction

`minshop-edge-plus` is an enhanced edge ecommerce platform developed as a secondary development of `minshop`. Built on Cloudflare's serverless edge ecosystem (Astro SSR on Cloudflare Workers, SQLite on Cloudflare D1, zero-egress asset storage on Cloudflare R2), it delivers sub-second response times and minimal cold-start overhead.

Designed for seamless human and autonomous AI agent operations, human shoppers enjoy server-rendered, JavaScript-optional shopping and checkout, while AI agents can autonomously query the catalog and settle Lightning invoices via clean JSON APIs or the Model Context Protocol (MCP).

### Features & Key Enhancements

In addition to all core capabilities of upstream `minshop`, this project introduces four substantive enhancements (mapped to `CHANGES.md`):

1. **Marketing & Promotions: Multi-Strategy Discount & Coupon Calculation Engine**
   - **Pure Functional Calculation Engine**: Implemented `src/features/discounts/engine.ts` operating strictly in integer minor units (cents) to eliminate floating-point precision loss and avoid negative subtotal anomalies.
   - **Diverse Promotion Rules**: Supports percentage-based discounts (with optional `maxDiscountCents` capping), fixed amount deductions, and free-shipping discounts.
   - **Strict Guardrails**: Enforces minimum spend thresholds (`minSubtotalCents`), activation and expiration date windows, maximum redemption limits, and case-insensitive promo code normalization.
   - **Public API & Programmatic Checkout**: Provides `/api/coupon/validate` for real-time coupon evaluation and extends programmatic JSON checkout (`/api/checkout`) to support `coupon_code`.

2. **Edge Consistency: Stale Hosted Checkout Reservation Auto-Reclamation**
   - **Fixing Inventory Lockup**: Upstream relied exclusively on external provider webhooks to release inventory for hosted checkouts (Stripe / OpenNode). Network delays, partition failures, or abandoned checkout tabs left inventory held permanently.
   - **Automated Orphan Reclamation**: Introduced `releaseStaleHostedReservations`, safely expiring stale reservations exceeding a grace period (default 24h) with no associated paid orders via single atomic queries.
   - **Scheduled Sweep & Cache Invalidation**: Integrated into worker scheduled cron sweeps alongside automated edge cache tag purges (`purgeStockProductCache`).

3. **Settlement & Stock Discrepancy Reconciliation: Batch Processing & Shortfall Aggregation**
   - **Batch Resolution**: Added `batchResolveInventoryExceptions` in `src/features/orders/db.ts` to reconcile multiple inventory exception records atomically.
   - **Shortfall Aggregation**: Added `getInventoryExceptionSummary` to aggregate outstanding `shortfall_qty` across products and variants for simplified replenishment.

4. **Code Quality, Clean Diagnostics & Resilient Testing Harness**
   - **Zero Warnings Diagnostics**: Eliminated unused imports and variables in `src/pages/checkout.astro` and `create-minshop/src/scaffold.js`.
   - **CI Non-Interactive Execution**: Enhanced `scripts/check-mcp.sh` to prevent interactive prompts in automated environments.
   - **Test Harness Flake Prevention**: Hardened `test/integration/d1-integration.sh` by recognizing Miniflare 500 socket disconnect errors and applying proper retries.

### Quick Start

#### Prerequisites
- **Node.js**: ≥ 22.12
- **Git**

#### Setup & Execution

1. **Clone repository and install dependencies**:
   ```sh
   git clone <repository_url>
   cd minshop-edge-plus
   npm install
   npm install --prefix mcp
   ```

2. **Initialize local environment and database (with seed data)**:
   ```sh
   npm run provision:local -- --seed
   ```

3. **Start development server**:
   ```sh
   npm run dev
   ```
   Open `http://localhost:4321` in your browser.

4. **Run verification gate**:
   ```sh
   npm run verify
   ```

### Source & Acknowledgements

*This project is based on [minshop](https://github.com/ddyy/minshop) (secondary development), originally open-sourced by [ddyy](https://github.com/ddyy) under the MIT License.*

### License

This project is licensed under the MIT License. See the root [LICENSE](LICENSE) for the full text.
