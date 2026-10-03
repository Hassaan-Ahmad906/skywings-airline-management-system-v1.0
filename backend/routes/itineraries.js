const router = require('../middleware/asyncRouter')();
const { authenticate } = require('../middleware/auth');
const service = require('../services/itineraryService');
router.use(authenticate);
router.post('/',async(req,res)=>res.status(201).json({ success:true,data:{ itinerary:await service.create(req.user.userId,req.body) } }));
router.get('/:id',async(req,res)=>{
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id<1) return res.status(400).json({ success:false,message:'Invalid journey' });
  res.json({ success:true,data:{ itinerary:await service.details(require('../config/database').pool,req.user.userId,id) } });
});
router.post('/:id/pay',async(req,res)=>res.json({ success:true,data:await service.pay(req.user.userId,req.params.id) }));
module.exports = router;
