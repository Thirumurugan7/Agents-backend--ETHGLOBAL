import express from "express";
import dotenv from "dotenv";
import cors from "cors";


import helpActionRoutes from './routes/helpAction.route.js'

const app = express();
dotenv.config();
// Middleware
app.use(express.json());
app.use(cors());



// Routes


app.use("/api/action", helpActionRoutes);

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
