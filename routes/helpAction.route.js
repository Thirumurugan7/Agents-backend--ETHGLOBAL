import express from "express";
import {reclaimSBT, sbtmint, createToken, sellTokens, buyTokens} from "../controllers/helpAction.controller.js";

const router = express.Router();

router.post('/setPoints',sbtmint)
router.get("/getPoints", reclaimSBT);
router.post('/createToken', createToken);
router.post('/sell-tokens', sellTokens);
router.post('/buy-tokens', buyTokens);
export default router;
