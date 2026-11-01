import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import router from "./routes";
import { logger } from "./lib/logger";
import { env } from "./config/env";
import { hydrateSettingsFromRemote } from "./config/settings-store";
import { errorHandlerMiddleware } from "./lib/errors";

// ESM and CJS safe directory resolution
const currentFilename =
  typeof __filename !== "undefined"
    ? __filename
    : typeof import.meta !== "undefined" && import.meta.url
      ? fileURLToPath(import.meta.url)
      : process.cwd();
const currentDirname =
  typeof __dirname !== "undefined" ? __dirname : path.dirname(currentFilename);

const app: Express = express();

// Trust the first reverse proxy (Vercel / Render / Nginx) for accurate IP rate limiting & secure cookies
app.set("trust proxy", 1);
app.disable("x-powered-by");

const pinoHttpMiddleware: any = (pinoHttp as any).default || pinoHttp;

app.use(
  pinoHttpMiddleware({
    logger,
    serializers: {
      req(req: any) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res: any) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors({ credentials: true, origin: true }));

// Security headers
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

// Handle Vercel Serverless pre-parsed body without deleting cookies
app.use((req, _res, next) => {
  if (req.body && typeof req.body === "object" && !(req as any)._body) {
    (req as any)._body = true;
  }
  next();
});

app.use(express.json({ limit: "8mb" }));
app.use(express.urlencoded({ extended: true, limit: "8mb" }));
app.use(cookieParser());

// Hydrate platform settings from durable remote store once per cold start
app.use(async (_req, _res, next) => {
  try {
    await hydrateSettingsFromRemote();
  } catch {
    // Non-fatal on cold start; durable writes validate explicitly
  }
  next();
});

// Mount API routes under /api and root (handles both rewritten Vercel paths and direct server calls)
app.use("/api", router);
app.use(router);

// Serve static frontend files in production / standalone server
const possibleDistPaths = [
  path.resolve(process.cwd(), "dist"),
  path.resolve(process.cwd(), "artifacts/court-session-management/dist"),
  path.resolve(currentDirname, "../../court-session-management/dist"),
  path.resolve(currentDirname, "../dist"),
  path.resolve(currentDirname, "../../dist"),
];

const distPath = possibleDistPaths.find((p) => {
  try {
    return fs.existsSync(path.join(p, "index.html"));
  } catch {
    return false;
  }
});

if (distPath) {
  logger.info(`[Server] Serving static frontend from: ${distPath}`);
  app.use(express.static(distPath));
  app.use((req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(distPath, "index.html"));
  });
}

// Unified structured Arabic error handler with referenceCode & zero internal leaks
app.use(errorHandlerMiddleware);

export default app;
