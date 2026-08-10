# Enterprise Copy Trading Platform

This folder is the enterprise-grade evolution of the existing copy trading backend foundation.

## Foundation source
The original project under the parent folder remains the base implementation that this enterprise version extends.

## Planned architecture
- Multi-tenant user and account management
- Broker integrations for MT5 / MetaTrader and API adapters
- Copy trading engine with risk controls
- Real-time market and trade streaming
- Strategy marketplace and performance analytics
- Admin dashboards and compliance monitoring
- Payment, wallet, and payout flows
- Notifications, audit trails, and reporting

## Immediate next steps
1. Review the existing backend patterns in the parent folder.
2. Add modular service layers and repository structure.
3. Introduce enterprise auth, RBAC, and audit logging.
4. Build strategy risk engine and investor allocation rules.
5. Add real-time dashboards and webhook integrations.

This folder is intentionally created as the enterprise branch for the platform build.

## Startup behavior
The server automatically finds the next available free port when port 3000 is already occupied, which prevents startup failures in local development and multi-service environments.
