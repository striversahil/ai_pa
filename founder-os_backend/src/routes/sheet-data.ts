import { Router } from 'express';
import { GoogleSheetsService } from '../modules/google_sheets/service';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const spreadsheetId = (req.query.spreadsheetId as string) || '1OsQevXQpPT1x2iJgcg0lgUcOInxjZh3tvfNjxAbcENs';
  const range = (req.query.range as string) || 'A1:Z1000';
  const data = await GoogleSheetsService.getSpreadsheetData(spreadsheetId, range);
  res.status(200).json(data);
}));

export default router;
