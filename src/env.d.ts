/** Secrets are not emitted by `wrangler types` from vars — declare them here. */
interface Env {
  ZAI_API_KEY: string;
}

declare namespace Cloudflare {
  interface Env {
    ZAI_API_KEY: string;
  }
}
