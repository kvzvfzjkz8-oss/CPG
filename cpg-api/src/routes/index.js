import { Router } from 'express';
import authRoutes from './auth.routes.js';
import clientRoutes from './client.routes.js';
import adminRoutes from './admin.routes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/client', clientRoutes);
router.use('/admin', adminRoutes);

export default router;
