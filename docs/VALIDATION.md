# Validation record

Validated on 2026-10-09 with Node 22.23.3.

- TypeScript and Vite production build: passed.
- Physical and project tests: **21 passed**.
- Chromium browser integration tests: **8 passed**.
- Dependency audit: zero reported vulnerabilities after upgrading Vitest.
- Docker: multistage image build passed; nginx serves the application on port 8080; health check passed.

## Measured heating challenge reference

Default source 240 V, switch 0.01 Ω, heater 28.8 Ω and 300 J/K, heater/water conductance 180 W/K, heater ambient loss 0.5 W/K, tank ambient loss 2.2 W/K, water 10 kg at 20°C, ambient 20°C. Fixed step 1/60 s.

| Quantity | Calculated value |
| --- | ---: |
| Completion time | 1,323.45 s |
| Water temperature at completion | 80.000478°C |
| Electrical energy | 2,645,981.26 J |
| Stored thermal energy | 2,529,284.29 J |
| Heat lost to ambient | 116,696.97 J |
| Energy balance residual | 0.00000922 J |
| Peak electrical input | 1,999.306 W |
| Cost | €158 |
| Rating | 3 stars, 90/100 |

The result includes element heating, switch dissipation, and ambient losses. It exceeds the 2,508,000 J water-only lower bound without a scripted energy penalty.

## Browser coverage

Both assignments are constructed by clicking actual terminal pairs and completed using solver state. The browser suite exercises Run/Pause/Reset, real heating, energy diagnostics, domain validation, drag placement, duplicate/undo/rotate/delete, zoom, JSON download/import/rejection, CSV export, deterministic replay, and mobile overflow checks.

The browser tool test uses an injected registry shim to verify schema registration, valid advance input and state read-back, and invalid-input rejection. Native WebMCP host validation is unavailable in this environment; WebMCP is optional and feature-detected.

Tests establish correctness for the documented linear DC and lumped thermal models. They do not validate CFD, rigid-body mechanics, phase change, manufacturer-specific failure curves, or scenarios beyond the declared scene limits.
