import { Router } from 'express';
import { jupiter } from '../jupiter/index.js';
import { parseOptionalInt, queryString, sendJupiterError } from './jupiter-error.js';

export const eventsRouter = Router();

/**
 * List prediction events from Jupiter.
 * Query: category, filter, includeMarkets, start, end, etc.
 */
eventsRouter.get('/', async (req, res) => {
  const query = queryString(req, [
    'category',
    'subcategory',
    'tags',
    'filter',
    'sortBy',
    'sortDirection',
    'includeMarkets',
    'includeAllMarkets',
  ]);

  const start = parseOptionalInt(req.query['start']);
  const end = parseOptionalInt(req.query['end']);
  if (start !== undefined) {
    query['start'] = String(start);
  }
  if (end !== undefined) {
    query['end'] = String(end);
  }

  if (!query['includeMarkets']) {
    query['includeMarkets'] = 'true';
  }

  try {
    const result = await jupiter.getEvents(query);
    res.json(result);
  } catch (error) {
    sendJupiterError(res, error);
  }
});
