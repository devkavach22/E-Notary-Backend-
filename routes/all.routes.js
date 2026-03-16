const express = require("express");
const router = express.Router();
const {
  sendOTP,
  verifyOTP,
  registerAdvocate,
  getAdvocateById,
  sendMobileOTP,
  verifyMobileOTP
} = require("../controllers/advocate.controller");
const { advocateLogin, adminLogin,
  sendForgetPasswordOtp, 
  confirmPassword} = require("../controllers/Auth.controller");
const {
  advocateUpload,
  handleUploadError,
} = require("../middlewares/upload.middleware");

router.post("/send-otp", sendOTP);
router.post("/verify-otp", verifyOTP);
router.post("/send-mobile-otp", sendMobileOTP);
router.post("/verify-mobile-otp", verifyMobileOTP);


router.post("/register", advocateUpload, handleUploadError, registerAdvocate);
router.get("/:id", getAdvocateById);
router.post("/advocate/login", advocateLogin);
router.post("/admin/login", adminLogin);

const {
  getAllAdvocates,
  getPendingAdvocates,
  getAdvocateDetails,
  ocrVerify,
  verifyDocuments,
  approveAdvocate,
  rejectAdvocate,
} = require("../controllers/Admin.controller");

const { adminAuth } = require("../middlewares/Auth.middleware");

// forget password -----
router.post("/send-forget-password-otp", sendForgetPasswordOtp);
router.post("/confirm-password", confirmPassword);
// ------

router.get("/admin/advocates", adminAuth, getAllAdvocates);
router.get("/admin/advocates/pending", adminAuth, getPendingAdvocates);

router.get("/admin/advocate/:id", adminAuth, getAdvocateDetails);
router.put("/admin/advocate/:id/ocr-verify", adminAuth, ocrVerify);
router.put("/admin/advocate/:id/verify-documents", adminAuth, verifyDocuments);

router.put("/admin/advocate/:id/approve", adminAuth, approveAdvocate);
router.put("/admin/advocate/:id/reject", adminAuth, rejectAdvocate);

module.exports = router;