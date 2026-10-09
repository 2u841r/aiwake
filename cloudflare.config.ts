import { bindings, defineConfig, triggers } from "cf/config";

/**
 * Keep in sync with wrangler.jsonc.
 * Secret: pnpm exec wrangler secret put ZAI_API_KEY
 * @see https://developers.cloudflare.com/workers/configuration/secrets/
 */

export default defineConfig({
	worker: {
		name: "aiwake",
		compatibilityDate: "2026-10-09",
		compatibilityFlags: [
			"nodejs_compat",
		],
		entrypoint: "src/index.ts",
		observability: {
			enabled: true,
			traces: {
				enabled: true,
			},
		},
		triggers: [
			triggers.scheduled({
				schedule: "0 0,20,21,22,23 * * *",
			}),
		],
		env: {
			AI_TIME: bindings.text("0200am"),
			AI_TIMEZONE: bindings.text("Asia/Dhaka"),
			AI_WINDOW_HOURS: bindings.text("5"),
			ZAI_MODEL: bindings.text("glm-5.3-flash"),
		},
	},
});
