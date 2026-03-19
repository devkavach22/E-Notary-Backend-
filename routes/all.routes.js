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
const { login,
  sendForgetPasswordOtp, 
  confirmPassword} = require("../controllers/Auth.controller");
const {
  advocateUpload,
  userUpload,
  handleUploadError,
} = require("../middlewares/upload.middleware");
const { UserverifyDocuments,registerUser, getUserById } = require("../controllers/User.controller");


router.post("/send-otp", sendOTP);
router.post("/verify-otp", verifyOTP);
router.post("/send-mobile-otp", sendMobileOTP);
router.post("/verify-mobile-otp", verifyMobileOTP);
router.post("/login",login)


router.post("/register", advocateUpload, handleUploadError, registerAdvocate);
router.get("/:id", getAdvocateById);


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



// User Creation Done -------
router.post("/user/verify-documents", userUpload, handleUploadError, UserverifyDocuments);
router.post("/user/register",         userUpload, handleUploadError, registerUser);
router.get("/user/:id",               getUserById);

module.exports = router;