import { Router } from 'express';
import type { Request, Response } from 'express';
import { leaguesService } from './leagues.service.js';
import { sendSuccess, sendPaginated } from '@/shared/utils/response.js';
import { asyncHandler } from '@/shared/middlewares/async-handler.js';
import { ApiError } from '@/shared/utils/api-error.js';
import { LeagueFiltersSchema, LeagueSchema } from './leagues.types.js';
import { HTTP_STATUS } from '@/shared/constants.js';

const router = Router();

/**
 * @swagger
 * /api/leagues:
 *   get:
 *     summary: Get all leagues with optional filters
 *     parameters:
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [roto, h2h-points, h2h-category]
 *       - in: query
 *         name: draftType
 *         schema:
 *           type: string
 *           enum: [auction, snake]
 *       - in: query
 *         name: isDefault
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 */
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const filters = LeagueFiltersSchema.parse(req.query);
    const { leagues, pagination } = await leaguesService.getLeagues(filters);
    sendPaginated(res, leagues, pagination);
  }),
);

/**
 * @swagger
 * /api/leagues:
 *   post:
 *     summary: Create or update a custom league format
 */
router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const leagueData = LeagueSchema.parse(req.body);
    const league = await leaguesService.upsertLeague(leagueData);
    sendSuccess(res, league, undefined, HTTP_STATUS.CREATED);
  }),
);

/**
 * @swagger
 * /api/leagues/{id}:
 *   get:
 *     summary: Get a single league by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 */
router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const league = await leaguesService.getLeagueById(id as string);
    if (!league) {
      throw new ApiError(404, 'League not found');
    }
    sendSuccess(res, league);
  }),
);

/**
 * @swagger
 * /api/leagues/{id}:
 *   delete:
 *     summary: Delete a league by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 */
router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const deletedLeague = await leaguesService.deleteLeagueById(id as string);
    if (!deletedLeague) {
      throw new ApiError(404, 'League not found');
    }
    sendSuccess(res, deletedLeague);
  }),
);

export default router;
