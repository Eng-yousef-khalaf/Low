import { Router, type IRouter } from "express";
import { getDashboardStats } from "../services/session.service";
import {
  attachAuthUser,
  requireAuth,
  requireActiveSubscription,
} from "../middlewares/auth.middleware";

const router: IRouter = Router();

router.get(
  "/dashboard/stats",
  attachAuthUser,
  requireAuth,
  requireActiveSubscription,
  async (req, res, next) => {
    try {
      const stats = await getDashboardStats(req.userId);
      res.setHeader("X-Synced-At", stats.lastSyncedAt || new Date().toISOString());
      res.json(stats);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
