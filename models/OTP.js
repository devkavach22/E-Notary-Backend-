const mongoose = require("mongoose");

const otpSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: false,
      lowercase: true,
      trim: true,
    },

    // ─── Mobile number add kiya ──────────────────────────
    mobile: {
      type: String,
      required: false,
      trim: true,
    },

    otp: {
      type: String,
      required: true,
    },

    purpose: {
      type: String,
      enum: ["email_verify", "mobile_verify"],
      required: true,
    },

    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 10 * 60 * 1000),
      index: { expires: 0 },
    },

    isUsed: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("OTP", otpSchema);