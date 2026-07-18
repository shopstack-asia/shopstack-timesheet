# AI Implementation — README

Slack Timesheet AI Agent MVP as implemented in this repository.

**Specs followed:** `docs/ai-discovery/*`, `docs/ai-spec/*`  
**Plan:** [00_implementation_plan.md](./00_implementation_plan.md)

## Documents

| File | Topic |
|------|--------|
| [01_architecture.md](./01_architecture.md) | Layers and data flow |
| [02_identity_auth_bridge.md](./02_identity_auth_bridge.md) | Slack → EmployeeID |
| [03_agent_runtime.md](./03_agent_runtime.md) | Intents, merge, confirm |
| [04_slack_setup.md](./04_slack_setup.md) | Slack app configuration |
| [05_environment_variables.md](./05_environment_variables.md) | Env vars |
| [06_testing_guide.md](./06_testing_guide.md) | Tests |
| [07_deployment_guide.md](./07_deployment_guide.md) | Deploy |
| [08_known_limitations.md](./08_known_limitations.md) | Gaps |

## Quick start

1. Configure Redis, Zoho, Sheets, Slack bot token + signing secret, optional AI_*  
2. Create Slack app with scopes in `04_slack_setup.md`  
3. Point Event Subscriptions to `https://<host>/api/slack/events`  
4. Point Interactivity to `https://<host>/api/slack/interactions`  
5. DM the bot or `@mention` it in a channel
