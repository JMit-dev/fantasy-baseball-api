import { Router } from 'express';
import type { Request, Response } from 'express';
import { valuationsService } from './valuations.service.js';
import { sendSuccess } from '@/shared/utils/response.js';
import { asyncHandler } from '@/shared/middlewares/async-handler.js';
import { ValuationRequestSchema } from './valuations.types.js';

const router = Router();

/**
 * @swagger
 * /api/valuations:
 *   post:
 *     summary: Calculate player dollar valuations and draft eligibility from a league payload
 *     description: >
 *       Returns ranked player valuations based on 3-season averaged stats weighted by the
 *       provided league scoring rules and draft state. The API does not persist league data.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [league]
 *             properties:
 *               league:
 *                 type: object
 *               query:
 *                 type: object
 *     responses:
 *       200:
 *         description: Player valuations sorted by dollar value descending
 */
router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const { league, query } = ValuationRequestSchema.parse(req.body);
    const result = await valuationsService.calculateValuationsForLeague(
      league,
      query,
    );
    sendSuccess(res, result);
  }),
);

export default router;
