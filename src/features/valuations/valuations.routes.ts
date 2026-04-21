import { Router } from 'express';
import type { Request, Response } from 'express';
import { valuationsService } from './valuations.service.js';
import { sendSuccess } from '@/shared/utils/response.js';
import { asyncHandler } from '@/shared/middlewares/async-handler.js';
import { ValuationQuerySchema } from './valuations.types.js';

const router = Router();

/**
 * @swagger
 * /api/valuations/{leagueId}:
 *   get:
 *     summary: Calculate player dollar valuations and draft eligibility for a league
 *     description: >
 *       Returns ranked player valuations based on 3-season averaged stats weighted by league
 *       scoring categories. Applies multipliers for depth chart position, age, and injury
 *       status. Optionally checks draftability against a specific team's open roster slots.
 *     parameters:
 *       - in: path
 *         name: leagueId
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ID of the league
 *       - in: query
 *         name: teamId
 *         schema:
 *           type: string
 *         description: Team ID within the league — when provided, draftable reflects whether this team has an open slot
 *       - in: query
 *         name: playerType
 *         schema:
 *           type: string
 *           enum: [hitter, pitcher]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 100
 *     responses:
 *       200:
 *         description: Player valuations sorted by dollar value descending
 *       404:
 *         description: League not found
 */
router.get(
  '/:leagueId',
  asyncHandler(async (req: Request, res: Response) => {
    const { leagueId } = req.params;
    const query = ValuationQuerySchema.parse(req.query);
    const result = await valuationsService.calculateValuations(leagueId as string, query);
    sendSuccess(res, result);
  }),
);

export default router;
