const Advocate = require("../models/Advocate");
const OTP = require("../models/OTP");
const { generateOTP, sendOTPEmail } = require("./sendOTP");

// ─── HARDCODED TEST OTP ───────────────────────────────────
const TEST_MOBILE_OTP = "872356";

const parseDOB = (dobInput) => {
  if (!dobInput) return null;
  const str = String(dobInput).trim();

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
    const [day, month, year] = str.split("/");
    return new Date(`${year}-${month}-${day}T12:00:00.000Z`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return new Date(`${str}T12:00:00.000Z`);
  }
  if (str.includes("T")) {
    const d = new Date(str);
    d.setUTCHours(12, 0, 0, 0);
    return d;
  }
  const d = new Date(str);
  if (!isNaN(d)) {
    d.setUTCHours(12, 0, 0, 0);
    return d;
  }
  return null;
};

// ═══════════════════════════════════════════════════
// SEND OTP — email ke liye
// ═══════════════════════════════════════════════════
const sendOTP = async (req, res) => {
  try {
    const { email, purpose } = req.body;

    if (!email || !purpose) {
      return res.status(400).json({
        success: false,
        message: "Email and purpose are required",
      });
    }

    if (!["email_verify", "mobile_verify"].includes(purpose)) {
      return res.status(400).json({
        success: false,
        message: "Invalid purpose",
      });
    }

    if (purpose === "email_verify") {
      const existing = await Advocate.findOne({ email });
      if (existing) {
        return res.status(409).json({
          success: false,
          message: "Email already registered",
        });
      }
    }

    await OTP.deleteMany({ email, purpose });

    const otp = generateOTP();
    await OTP.create({ email, otp, purpose });
    await sendOTPEmail(email, otp, purpose);

    return res.status(200).json({
      success: true,
      message: "OTP sent successfully",
    });
  } catch (error) {
    console.error("sendOTP Error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ═══════════════════════════════════════════════════
// VERIFY OTP — email ke liye
// ═══════════════════════════════════════════════════
const verifyOTP = async (req, res) => {
  try {
    const { email, otp, purpose } = req.body;

    if (!email || !otp || !purpose) {
      return res.status(400).json({
        success: false,
        message: "Email, OTP and purpose are required",
      });
    }

    const otpRecord = await OTP.findOne({ email, purpose, isUsed: false });

    if (!otpRecord) {
      return res.status(404).json({
        success: false,
        message: "OTP not found or already used",
      });
    }

    if (otpRecord.expiresAt < new Date()) {
      return res.status(400).json({
        success: false,
        message: "OTP has expired. Please request a new one",
      });
    }

    if (otpRecord.otp !== otp) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    otpRecord.isUsed = true;
    await otpRecord.save();

    return res.status(200).json({
      success: true,
      message: "OTP verified successfully",
    });
  } catch (error) {
    console.error("verifyOTP Error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ═══════════════════════════════════════════════════
// SEND MOBILE OTP — testing ke liye hardcoded
// @route POST /api/advocate/send-mobile-otp
// Body: { mobile }
// ═══════════════════════════════════════════════════
const sendMobileOTP = async (req, res) => {
  try {
    const { mobile } = req.body;

    if (!mobile) {
      return res.status(400).json({
        success: false,
        message: "Mobile number is required",
      });
    }

    if (!/^[6-9]\d{9}$/.test(mobile)) {
      return res.status(400).json({
        success: false,
        message: "Invalid mobile number format",
      });
    }

    // Purana OTP delete karo
    await OTP.deleteMany({ mobile, purpose: "mobile_verify" });

    // Testing ke liye hardcoded OTP save karo DB mein
    await OTP.create({
      mobile,
      otp: TEST_MOBILE_OTP,
      purpose: "mobile_verify",
    });

    return res.status(200).json({
      success: true,
      // Testing mein OTP response mein dikhao
      message: `OTP sent successfully (Test OTP: ${TEST_MOBILE_OTP})`,
    });
  } catch (error) {
    console.error("sendMobileOTP Error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ═══════════════════════════════════════════════════
// VERIFY MOBILE OTP
// @route POST /api/advocate/verify-mobile-otp
// Body: { mobile, otp }
// ═══════════════════════════════════════════════════
const verifyMobileOTP = async (req, res) => {
  try {
    const { mobile, otp } = req.body;

    if (!mobile || !otp) {
      return res.status(400).json({
        success: false,
        message: "Mobile and OTP are required",
      });
    }

    // DB se OTP find karo
    const otpRecord = await OTP.findOne({
      mobile,
      purpose: "mobile_verify",
      isUsed: false,
    });

    if (!otpRecord) {
      return res.status(404).json({
        success: false,
        message: "OTP not found or already used. Please request a new one.",
      });
    }

    if (otpRecord.expiresAt < new Date()) {
      return res.status(400).json({
        success: false,
        message: "OTP has expired. Please request a new one.",
      });
    }

    if (otpRecord.otp !== otp) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    // OTP use mark karo
    otpRecord.isUsed = true;
    await otpRecord.save();

    // Advocate ka isMobileVerified true karo
    await Advocate.findOneAndUpdate(
      { mobile },
      { isMobileVerified: true }
    );

    return res.status(200).json({
      success: true,
      message: "Mobile verified successfully",
    });
  } catch (error) {
    console.error("verifyMobileOTP Error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ═══════════════════════════════════════════════════
// REGISTER ADVOCATE
// ═══════════════════════════════════════════════════
const registerAdvocate = async (req, res) => {
  try {
    const {
      fullName, dateOfBirth, gender, mobile, email, password,
      barCouncilNumber, barCouncilState, yearOfEnrollment,
      practiceAreas, languagesKnown, city, state, officeAddress,
      pincode, aadhaarNumber, panNumber, accountHolderName,
      bankName, accountNumber, ifscCode, upiId,
      availableDays, availableFrom, availableTo, perDocumentFee,
    } = req.body;

    const files = req.files;
    if (!files || !files.liveSelfie || !files.aadhaarFront ||
        !files.aadhaarBack || !files.panCard || !files.barCouncilCertificate) {
      return res.status(400).json({
        success: false,
        message: "All documents and live selfie are required",
      });
    }

    const parsedDOB = parseDOB(dateOfBirth);
    if (!parsedDOB) {
      return res.status(400).json({
        success: false,
        message: "Invalid dateOfBirth format. Use DD/MM/YYYY or YYYY-MM-DD",
      });
    }

    const emailExists = await Advocate.findOne({ email });
    if (emailExists) return res.status(409).json({ success: false, message: "Email already registered" });

    const mobileExists = await Advocate.findOne({ mobile });
    if (mobileExists) return res.status(409).json({ success: false, message: "Mobile number already registered" });

    const aadhaarExists = await Advocate.findOne({ aadhaarNumber });
    if (aadhaarExists) return res.status(409).json({ success: false, message: "Aadhaar number already registered" });

    const panExists = await Advocate.findOne({ panNumber });
    if (panExists) return res.status(409).json({ success: false, message: "PAN number already registered" });

    const barCouncilExists = await Advocate.findOne({ barCouncilNumber });
    if (barCouncilExists) return res.status(409).json({ success: false, message: "Bar Council number already registered" });

    const emailOTPVerified = await OTP.findOne({ email, purpose: "email_verify", isUsed: true });
    if (!emailOTPVerified) {
      return res.status(400).json({
        success: false,
        message: "Email is not verified. Please verify your email first",
      });
    }

    // ─── Mobile OTP verified check ─────────────────────
    const mobileOTPVerified = await OTP.findOne({
      mobile,
      purpose: "mobile_verify",
      isUsed: true,
    });
    if (!mobileOTPVerified) {
      return res.status(400).json({
        success: false,
        message: "Mobile is not verified. Please verify your mobile first",
      });
    }

    const parsedPracticeAreas = typeof practiceAreas === "string" ? JSON.parse(practiceAreas) : practiceAreas;
    const parsedLanguages = typeof languagesKnown === "string" ? JSON.parse(languagesKnown) : languagesKnown;
    const parsedAvailableDays = typeof availableDays === "string" ? JSON.parse(availableDays) : availableDays;

    const advocate = await Advocate.create({
      fullName, dateOfBirth: parsedDOB, gender, mobile, email, password,
      barCouncilNumber, barCouncilState, yearOfEnrollment,
      practiceAreas: parsedPracticeAreas,
      languagesKnown: parsedLanguages,
      city, state, officeAddress, pincode, aadhaarNumber, panNumber,
      liveSelfie: files.liveSelfie[0].path,
      documents: {
        aadhaarFront: files.aadhaarFront[0].path,
        aadhaarBack: files.aadhaarBack[0].path,
        panCard: files.panCard[0].path,
        barCouncilCertificate: files.barCouncilCertificate[0].path,
      },
      bankDetails: { accountHolderName, bankName, accountNumber, ifscCode, upiId: upiId || null },
      availableDays: parsedAvailableDays,
      availableHours: { from: availableFrom, to: availableTo },
      perDocumentFee,
      isEmailVerified: true,
      isMobileVerified: true, // OTP verify ho gaya tha
    });

    return res.status(201).json({
      success: true,
      message: "Advocate registered successfully. Your account is under review.",
      data: {
        id: advocate._id,
        fullName: advocate.fullName,
        email: advocate.email,
        approvalStatus: advocate.approvalStatus,
      },
    });
  } catch (error) {
    console.error("registerAdvocate Error:", error);

    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: messages[0] });
    }
    if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(409).json({ success: false, message: `${field} already exists` });
    }
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const getAdvocateById = async (req, res) => {
  try {
    const advocate = await Advocate.findById(req.params.id).select("-password");
    if (!advocate) {
      return res.status(404).json({ success: false, message: "Advocate not found" });
    }
    return res.status(200).json({ success: true, data: advocate });
  } catch (error) {
    console.error("getAdvocateById Error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

module.exports = {
  sendOTP,
  verifyOTP,
  sendMobileOTP,
  verifyMobileOTP,
  registerAdvocate,
  getAdvocateById,
};