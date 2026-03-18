const jwt = require("jsonwebtoken");
const Advocate = require("../models/Advocate");
const Admin = require("../models/Admin");
const { generateOTP, sendForgetPasswordOTP } = require("./sendOTP");

// ─── OTP in-memory store ──────────────────────────────────
const otpStore = new Map();

// ─── Generate Token ───────────────────────────────────────
const generateToken = (id, role) => {
  return jwt.sign({ id, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE,
  });
};

// ─────────────────────────────────────────────────────────
// @route   POST /api/auth/login
// @desc    Single login for Admin and Advocate (auto-detect)
// @access  Public
// ─────────────────────────────────────────────────────────
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    // ── Check Admin first ──
    let user = await Admin.findOne({ email }).select("+password");

    // ── If not Admin, check Advocate ──
    if (!user) {
      user = await Advocate.findOne({ email }).select("+password");
    }

    // ── Not found in either ──
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No account found with this email",
      });
    }

    // ── Verify password ──
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: "Incorrect password",
      });
    }

    // ── Get role from schema ──
    const role = user.role;

    // ── Advocate-specific approval checks ──
    if (role === "advocate") {
      if (user.approvalStatus === "pending") {
        return res.status(403).json({
          success: false,
          message: "Your account is under review. Please wait for admin approval",
        });
      }
      if (user.approvalStatus === "rejected") {
        return res.status(403).json({
          success: false,
          message: `Your account has been rejected. Reason: ${user.rejectionReason || "Contact admin"}`,
        });
      }
    }

    const token = generateToken(user._id, role);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      data: {
        id: user._id,
        email: user.email,
        role,
        ...(role === "advocate" && {
          fullName: user.fullName,
          approvalStatus: user.approvalStatus,
        }),
      },
    });
  } catch (error) {
    console.error("login Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// ─────────────────────────────────────────────────────────
// @route   POST /api/auth/send-forget-password-otp
// @desc    Send OTP to email - role auto detect
// @access  Public
// ─────────────────────────────────────────────────────────
const sendForgetPasswordOtp = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    // ── Auto detect role ──
    let user = await Admin.findOne({ email });
    if (!user) {
      user = await Advocate.findOne({ email });
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No account found with this email",
      });
    }

    const role = user.role;

    const otp = generateOTP();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 min

    otpStore.set(email, { otp, expiresAt, role });

    await sendForgetPasswordOTP(email, otp);

    return res.status(200).json({
      success: true,
      message: "OTP has been sent to your email",
    });
  } catch (error) {
    console.error("sendForgetPasswordOtp Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// ─────────────────────────────────────────────────────────
// @route   POST /api/auth/confirm-password
// @desc    Verify OTP and set new password
// @access  Public
// ─────────────────────────────────────────────────────────
const confirmPassword = async (req, res) => {
  try {
    const { email, otp, newPassword, confirmPassword } = req.body;

    if (!email || !otp || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Email, OTP, new password and confirm password are all required",
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long",
      });
    }

    // ── Verify OTP ──
    const record = otpStore.get(email);

    if (!record) {
      return res.status(400).json({
        success: false,
        message: "Please request an OTP first",
      });
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(email);
      return res.status(400).json({
        success: false,
        message: "OTP has expired, please request a new one",
      });
    }

    if (record.otp !== otp.toString()) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    // ── OTP verified — update password ──
    const { role } = record;
    const Model = role === "admin" ? Admin : Advocate;
    const user = await Model.findOne({ email }).select("+password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    user.password = newPassword; // bcrypt hash via pre-save hook
    await user.save();

    otpStore.delete(email); // OTP used, clean up

    return res.status(200).json({
      success: true,
      message: "Password updated successfully, please login",
    });
  } catch (error) {
    console.error("confirmPassword Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

module.exports = {
  login,
  sendForgetPasswordOtp,
  confirmPassword,
};