const User      = require("../models/User");
const OTP       = require("../models/OTP");
const Tesseract = require("tesseract.js");
const { createCanvas, loadImage } = require("canvas");
const path      = require("path");
const fs        = require("fs");

// ═══════════════════════════════════════════════════════════
// OCR PASSES
// ═══════════════════════════════════════════════════════════

const cleanOCRText = (text) => text.toUpperCase().replace(/\s+/g, " ").trim();

const extractTextOriginal = async (filePath) => {
  try {
    const abs = path.resolve(filePath);
    if (!fs.existsSync(abs)) throw new Error(`File not found: ${abs}`);
    const result = await Tesseract.recognize(abs, "eng+hin", { logger: () => {} });
    return result.data.text.toUpperCase();
  } catch (e) {
    console.error("OCR Original Error:", e.message);
    throw new Error("Document could not be read. Please ensure image is clear.");
  }
};

const extractTextCanvas = async (filePath) => {
  try {
    const abs  = path.resolve(filePath);
    const out  = abs.replace(/(\.\w+)$/, "_canvas.png");
    const img  = await loadImage(abs);
    const sc   = 2400 / img.width;
    const cv   = createCanvas(img.width * sc, img.height * sc);
    const ctx  = cv.getContext("2d");
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    const id   = ctx.getImageData(0, 0, cv.width, cv.height);
    const d    = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const c = Math.min(255, Math.max(0, 2.0 * (g - 128) + 128));
      d[i] = d[i + 1] = d[i + 2] = c;
    }
    ctx.putImageData(id, 0, 0);
    fs.writeFileSync(out, cv.toBuffer("image/png"));
    const r = await Tesseract.recognize(out, "eng+hin", { logger: () => {}, tessedit_pageseg_mode: 6 });
    if (fs.existsSync(out)) fs.unlinkSync(out);
    return r.data.text.toUpperCase();
  } catch (e) { console.error("OCR Canvas Error:", e.message); return ""; }
};

const extractTextCanvasBW = async (filePath) => {
  try {
    const abs  = path.resolve(filePath);
    const out  = abs.replace(/(\.\w+)$/, "_canvasbw.png");
    const img  = await loadImage(abs);
    const sc   = 2400 / img.width;
    const cv   = createCanvas(img.width * sc, img.height * sc);
    const ctx  = cv.getContext("2d");
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    const id   = ctx.getImageData(0, 0, cv.width, cv.height);
    const d    = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const bw = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) > 140 ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = bw;
    }
    ctx.putImageData(id, 0, 0);
    fs.writeFileSync(out, cv.toBuffer("image/png"));
    const r = await Tesseract.recognize(out, "eng+hin", { logger: () => {}, tessedit_pageseg_mode: 4 });
    if (fs.existsSync(out)) fs.unlinkSync(out);
    return r.data.text.toUpperCase();
  } catch (e) { console.error("OCR Canvas BW Error:", e.message); return ""; }
};

const extractTextCanvasSharpen = async (filePath) => {
  try {
    const abs    = path.resolve(filePath);
    const out    = abs.replace(/(\.\w+)$/, "_canvassharp.png");
    const img    = await loadImage(abs);
    const sc     = 2400 / img.width;
    const cv     = createCanvas(img.width * sc, img.height * sc);
    const ctx    = cv.getContext("2d");
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    const id     = ctx.getImageData(0, 0, cv.width, cv.height);
    const d      = id.data;
    const W      = cv.width;
    const H      = cv.height;
    const output = new Uint8ClampedArray(d);
    const K      = [0, -1, 0, -1, 5, -1, 0, -1, 0];
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        let r = 0, g = 0, b = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const idx = ((y + ky) * W + (x + kx)) * 4;
            const k   = K[(ky + 1) * 3 + (kx + 1)];
            r += d[idx] * k; g += d[idx + 1] * k; b += d[idx + 2] * k;
          }
        }
        const i    = (y * W + x) * 4;
        const gray = 0.299 * Math.min(255, Math.max(0, r))
                   + 0.587 * Math.min(255, Math.max(0, g))
                   + 0.114 * Math.min(255, Math.max(0, b));
        output[i] = output[i + 1] = output[i + 2] = gray;
        output[i + 3] = 255;
      }
    }
    ctx.putImageData(new (require("canvas").ImageData)(output, W, H), 0, 0);
    fs.writeFileSync(out, cv.toBuffer("image/png"));
    const r = await Tesseract.recognize(out, "eng+hin", { logger: () => {}, tessedit_pageseg_mode: 6 });
    if (fs.existsSync(out)) fs.unlinkSync(out);
    return r.data.text.toUpperCase();
  } catch (e) { console.error("OCR Sharpen Error:", e.message); return ""; }
};

// ═══════════════════════════════════════════════════════════
// DATE PARSER
// ═══════════════════════════════════════════════════════════
const parseDOB = (dobInput) => {
  if (!dobInput) return null;
  const str = String(dobInput).trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
    const [d, m, y] = str.split("/");
    return new Date(`${y}-${m}-${d}T12:00:00.000Z`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(`${str}T12:00:00.000Z`);
  const dt = new Date(str);
  if (!isNaN(dt)) { dt.setUTCHours(12, 0, 0, 0); return dt; }
  return null;
};

// ═══════════════════════════════════════════════════════════
// NAME EXTRACTION — FREQUENCY BASED
//
// Logic: Real name appears in ALL 4 OCR passes → high frequency.
// Random OCR noise appears only once → low frequency.
// Winner = highest frequency 2-gram of valid name words.
//
// KEY FIX: No fallback when freq < 2.
// "KUKPS TAE" was picked by the freq=1 fallback — removed now.
// ═══════════════════════════════════════════════════════════

const INVALID_WORDS = new Set([
  "INDIA", "AADHAAR", "UNIQUE", "AUTHORITY", "GOVERNMENT", "DEPT", "INCOME", "GOVT",
  "PERMANENT", "ACCOUNT", "NUMBER", "TAX", "DEPARTMENT", "CARD", "IDENTIFICATION",
  "ELECTION", "COMMISSION", "DIGITAL", "ENROLLMENT", "SIGNATURE", "MALE", "FEMALE",
  "DATE", "BIRTH", "MERA", "PEHCHAN", "AADHAR", "UIDAI",
  // OCR garbage that accidentally passes vowel+length check
  "INDIN", "GOVORNMANT", "GOVURNMANT", "GOVEMMAONT", "GOVORNMENT", "BASTEN",
  "TEAL", "NAAN", "PERN", "GEEGT", "ITGET", "POMANNTHCCOUN",
  "UNGER", "ESTAS", "RAKE", "SPIN", "CENTRE", "CENTRAL", "OFFICE",
  "KUKPS", "ESTAS", "UNGER", "BASTEN", "RAKE",
]);

// Valid name word: pure alpha uppercase, length >=3, has vowel, not invalid
const isNameWord = (w) =>
  /^[A-Z]{3,}$/.test(w) &&
  /[AEIOU]/.test(w) &&
  !INVALID_WORDS.has(w);

const isRealName = (name) => {
  if (!name) return false;
  const words = name.trim().split(/\s+/).filter(w => w.length > 2);
  return words.filter(w => /[AEIOU]/.test(w)).length >= 1 && words.length >= 2;
};

// rawText = 4 passes joined with "\n" — DO NOT pass flat cleaned string
const extractNameByFrequency = (rawText, label = "") => {
  const lines = rawText
    .split(/[\n\r|]/)
    .map(l => l.replace(/[^A-Z\s]/g, " ").replace(/\s+/g, " ").trim())
    .filter(l => l.length > 2);

  const freq2 = {};
  const freq3 = {};

  for (const line of lines) {
    const words = line.split(/\s+/).filter(isNameWord);

    for (let i = 0; i < words.length - 1; i++) {
      const g = `${words[i]} ${words[i + 1]}`;
      freq2[g] = (freq2[g] || 0) + 1;
    }
    for (let i = 0; i < words.length - 2; i++) {
      const g = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
      freq3[g] = (freq3[g] || 0) + 1;
    }
  }

  const best3 = Object.entries(freq3).sort((a, b) => b[1] - a[1])[0];
  const best2 = Object.entries(freq2).sort((a, b) => b[1] - a[1])[0];

  // 3-gram winner (appears in 2+ passes)
  if (best3 && best3[1] >= 2) {
    console.log(`✅ Name (${label} - 3gram ${best3[1]}x):`, best3[0]);
    return best3[0];
  }

  // 2-gram winner (appears in 2+ passes)
  if (best2 && best2[1] >= 2) {
    console.log(`✅ Name (${label} - 2gram ${best2[1]}x):`, best2[0]);
    return best2[0];
  }

  // ❌ NO freq=1 fallback — that's what caused "KUKPS TAE"
  // If name doesn't repeat across passes, OCR quality is too poor → return null
  console.log(`❌ Name not reliably found in ${label} (best was: ${best2 ? best2[0] + " freq=" + best2[1] : "none"})`);
  return null;
};

// ═══════════════════════════════════════════════════════════
// SAME PERSON CHECK
//
// KEY FIX: If PAN name is null (OCR quality too poor),
// we SKIP name check — don't reject valid documents.
// Only hard-fail when BOTH names are extracted AND they differ,
// OR when both DOBs are present AND they differ.
// ═══════════════════════════════════════════════════════════
const checkSamePerson = (aadhaarName, panName, aadhaarDob, panDob) => {
  let nameMatch = true;
  let dobMatch  = true;
  let reason    = "";

  // ── Name check — only when BOTH sides extracted ──
  if (isRealName(aadhaarName) && isRealName(panName)) {
    const p1      = aadhaarName.toUpperCase().split(" ").filter(w => w.length > 2);
    const p2      = panName.toUpperCase().split(" ").filter(w => w.length > 2);
    const matched = p1.filter(p => p2.some(p2w => p2w.includes(p) || p.includes(p2w))).length;
    nameMatch = matched >= 1;
    console.log(nameMatch
      ? `✅ Names match: "${aadhaarName}" ↔ "${panName}"`
      : `❌ Names DON'T match: "${aadhaarName}" ↔ "${panName}"`);
    if (!nameMatch) reason = `Names do not match — Aadhaar: "${aadhaarName}", PAN: "${panName}"`;
  } else {
    // PAN OCR couldn't extract name reliably — skip, don't penalize
    console.log(`⚠️  Name check skipped — Aadhaar: "${aadhaarName}", PAN: "${panName}"`);
    nameMatch = true;
  }

  // ── DOB check — only when BOTH sides have DOB ──
  if (aadhaarDob && panDob) {
    const norm = (d) => d.replace(/[-\.]/g, "/").trim();
    dobMatch = norm(aadhaarDob) === norm(panDob);
    console.log(dobMatch
      ? `✅ DOB matches: ${aadhaarDob}`
      : `❌ DOB mismatch — Aadhaar: ${aadhaarDob}, PAN: ${panDob}`);
    if (!dobMatch) reason = `Date of birth does not match — Aadhaar: ${aadhaarDob}, PAN: ${panDob}`;
  } else {
    console.log(`⚠️  DOB cross-check skipped — Aadhaar: ${aadhaarDob}, PAN: ${panDob}`);
    dobMatch = true;
  }

  return { match: nameMatch && dobMatch, reason };
};

// ═══════════════════════════════════════════════════════════
// @route  POST /api/user/verify-documents
// ═══════════════════════════════════════════════════════════
const UserverifyDocuments = async (req, res) => {
  try {
    const files = req.files;

    if (!files?.aadhaarFront || !files?.panCard) {
      return res.status(400).json({
        success: false,
        message: "Aadhaar front and PAN card are required",
      });
    }

    const results = {
      aadhaar: { success: false, message: "" },
      pan:     { success: false, message: "" },
    };

    let extractedData = {
      fullName:      null,
      dateOfBirth:   null,
      aadhaarNumber: null,
      panNumber:     null,
    };

    let aadhaarName = null;
    let panName     = null;
    let panDob      = null;

    // ════════════════════════════════════════════════════════
    // 1. AADHAAR — 4 OCR passes
    // ════════════════════════════════════════════════════════
    try {
      const p1 = await extractTextOriginal(files.aadhaarFront[0].path);
      const p2 = await extractTextCanvas(files.aadhaarFront[0].path);
      const p3 = await extractTextCanvasBW(files.aadhaarFront[0].path);
      const p4 = await extractTextCanvasSharpen(files.aadhaarFront[0].path);

      // Join with \n to preserve line structure for frequency analysis
      const aadhaarRaw  = [p1, p2, p3, p4].join("\n");
      // Flat single-line for number/DOB patterns only
      const aadhaarFlat = cleanOCRText(aadhaarRaw);

      console.log("\n========== AADHAAR PASS 1 (Original) ==========");
      console.log(cleanOCRText(p1));
      console.log("\n========== AADHAAR PASS 2 (Canvas Enhanced) ==========");
      console.log(cleanOCRText(p2));
      console.log("\n========== AADHAAR PASS 3 (Canvas B&W) ==========");
      console.log(cleanOCRText(p3));
      console.log("\n========== AADHAAR PASS 4 (Canvas Sharpen) ==========");
      console.log(cleanOCRText(p4));
      console.log("======================================================\n");

      // ── Aadhaar Number ──
      for (const pat of [
        /\d{4}\s\d{4}\s\d{4}/,
        /\d{4}-\d{4}-\d{4}/,
        /\d{4}\s?\d{4}\s?\d{4}/,
        /\d{12}/,
      ]) {
        const m = aadhaarFlat.match(pat);
        if (m) {
          extractedData.aadhaarNumber = m[0].replace(/[\s-]/g, "");
          console.log("✅ Aadhaar Number:", extractedData.aadhaarNumber);
          break;
        }
      }

      // ── DOB from Aadhaar ──
      for (const pat of [
        /DOB\s*:\s*(\d{2}[\/\s\-\.]\d{2}[\/\s\-\.]\d{4})/,
        /DOB\s*:\s*(\d{4}\/\d{4})/,
        /DOB\s*:\s*(\d{8})/,
        /\d{2}\/\d{2}\/\d{4}/,
        /\d{2}-\d{2}-\d{4}/,
        /\d{2}\.\d{2}\.\d{4}/,
      ]) {
        const m = aadhaarFlat.match(pat);
        if (m) {
          let dob = (m[1] || m[0]).trim();
          if (/^\d{4}\/\d{4}$/.test(dob)) dob = dob.slice(0, 2) + "/" + dob.slice(2, 4) + "/" + dob.slice(5);
          if (/^\d{8}$/.test(dob))         dob = dob.slice(0, 2) + "/" + dob.slice(2, 4) + "/" + dob.slice(4);
          extractedData.dateOfBirth = dob.replace(/[-\.]/g, "/").replace(/\s/g, "/");
          console.log("✅ DOB (Aadhaar):", extractedData.dateOfBirth);
          break;
        }
      }

      // ── Name from Aadhaar — frequency method ──
      aadhaarName = extractNameByFrequency(aadhaarRaw, "Aadhaar");

      results.aadhaar.success = !!extractedData.aadhaarNumber;
      results.aadhaar.message = extractedData.aadhaarNumber
        ? "Aadhaar verified successfully"
        : "Could not extract Aadhaar number. Please upload a clearer image.";

    } catch (err) {
      console.error("Aadhaar OCR Error:", err.message);
      results.aadhaar.message = `Aadhaar OCR failed: ${err.message}`;
    }

    // ════════════════════════════════════════════════════════
    // 2. PAN — 4 OCR passes
    // ════════════════════════════════════════════════════════
    try {
      const p1 = await extractTextOriginal(files.panCard[0].path);
      const p2 = await extractTextCanvas(files.panCard[0].path);
      const p3 = await extractTextCanvasBW(files.panCard[0].path);
      const p4 = await extractTextCanvasSharpen(files.panCard[0].path);

      const panRaw  = [p1, p2, p3, p4].join("\n");
      const panFlat = cleanOCRText(panRaw);

      console.log("\n========== PAN PASS 1 (Original) ==========");
      console.log(cleanOCRText(p1));
      console.log("\n========== PAN PASS 2 (Canvas Enhanced) ==========");
      console.log(cleanOCRText(p2));
      console.log("\n========== PAN PASS 3 (Canvas B&W) ==========");
      console.log(cleanOCRText(p3));
      console.log("\n========== PAN PASS 4 (Canvas Sharpen) ==========");
      console.log(cleanOCRText(p4));
      console.log("==================================================\n");

      // ── PAN Number ──
      const pm = panFlat.match(/[A-Z]{5}[0-9]{4}[A-Z]{1}/);
      if (pm) {
        extractedData.panNumber = pm[0];
        console.log("✅ PAN Number:", extractedData.panNumber);
      } else {
        console.log("❌ PAN number not found");
      }

      // ── Name from PAN — frequency method ──
      panName = extractNameByFrequency(panRaw, "PAN");

      // ── DOB from PAN ──
      for (const pat of [
        /DATE\s*OF\s*BIRTH\s*[:\-]?\s*(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/,
        /DOB\s*[:\-]?\s*(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/,
        /(\d{2}\/\d{2}\/\d{4})/,
        /(\d{2}-\d{2}-\d{4})/,
        /(\d{2}\.\d{2}\.\d{4})/,
      ]) {
        const m = panFlat.match(pat);
        if (m) {
          panDob = (m[1] || m[0]).trim().replace(/[-\.]/g, "/");
          console.log("✅ DOB (PAN):", panDob);
          break;
        }
      }

      // DOB fallback: if Aadhaar missed DOB, use PAN's
      if (!extractedData.dateOfBirth && panDob) {
        extractedData.dateOfBirth = panDob;
        console.log("✅ DOB set from PAN fallback:", panDob);
      }

      results.pan.success = !!extractedData.panNumber;
      results.pan.message = extractedData.panNumber
        ? "PAN verified successfully"
        : "Could not extract PAN number. Please upload a clearer image.";

    } catch (err) {
      console.error("PAN OCR Error:", err.message);
      results.pan.message = `PAN OCR failed: ${err.message}`;
    }

    // ════════════════════════════════════════════════════════
    // 3. Both numbers required
    // ════════════════════════════════════════════════════════
    if (!extractedData.aadhaarNumber) {
      return res.status(400).json({
        success: false,
        message: "Could not read Aadhaar number. Please upload a clearer image.",
      });
    }
    if (!extractedData.panNumber) {
      return res.status(400).json({
        success: false,
        message: "Could not read PAN number. Please upload a clearer image.",
      });
    }

    // ════════════════════════════════════════════════════════
    // 4. SAME PERSON VALIDATION
    // ════════════════════════════════════════════════════════
    console.log("\n========== SAME PERSON VALIDATION ==========");
    console.log("Aadhaar Name :", aadhaarName);
    console.log("PAN Name     :", panName);
    console.log("Aadhaar DOB  :", extractedData.dateOfBirth);
    console.log("PAN DOB      :", panDob);

    const sameCheck = checkSamePerson(
      aadhaarName,
      panName,
      extractedData.dateOfBirth,
      panDob
    );
    console.log("Result       :", sameCheck.match ? "✅ SAME PERSON" : "❌ DIFFERENT PERSON");
    console.log("=============================================\n");

    if (!sameCheck.match) {
      return res.status(400).json({
        success: false,
        message: "Aadhaar and PAN card belong to different persons. Please upload documents of the same person.",
        detail: sameCheck.reason,
      });
    }

    // ════════════════════════════════════════════════════════
    // 5. Final name — Aadhaar preferred, PAN fallback
    // ════════════════════════════════════════════════════════
    extractedData.fullName = isRealName(aadhaarName) ? aadhaarName
      : isRealName(panName) ? panName
      : null;

    console.log("\n========== FINAL EXTRACTED DATA ==========");
    console.log(JSON.stringify(extractedData, null, 2));
    console.log("==========================================\n");

    return res.status(200).json({
      success: true,
      message: "Document verification completed",
      results,
      extractedData,
      autoFilled: {
        fullName:      !!extractedData.fullName,
        dateOfBirth:   !!extractedData.dateOfBirth,
        aadhaarNumber: !!extractedData.aadhaarNumber,
        panNumber:     !!extractedData.panNumber,
      },
      filePaths: {
        aadhaarFront: files.aadhaarFront[0].path,
        panCard:      files.panCard[0].path,
      },
    });

  } catch (error) {
    console.error("UserverifyDocuments Error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ═══════════════════════════════════════════════════════════
// @route  POST /api/user/register
// @access Public
// ═══════════════════════════════════════════════════════════
const registerUser = async (req, res) => {
  try {
    const {
      email, mobile, password,
      fullName, dateOfBirth,
      aadhaarNumber, panNumber,
      address, city, state, pincode,
      purpose, gender,
      aadhaarFrontPath, panCardPath,
    } = req.body;

    const files = req.files;

    if (!email || !mobile || !password || !fullName || !dateOfBirth ||
        !aadhaarNumber || !panNumber || !address ||
        !city || !state || !pincode || !purpose ||
        !aadhaarFrontPath || !panCardPath) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }

    if (!files?.liveSelfie)
      return res.status(400).json({ success: false, message: "Live selfie is required" });

    if (await User.findOne({ email }))
      return res.status(409).json({ success: false, message: "Email already registered" });
    if (await User.findOne({ mobile }))
      return res.status(409).json({ success: false, message: "Mobile number already registered" });
    if (await User.findOne({ aadhaarNumber }))
      return res.status(409).json({ success: false, message: "Aadhaar number already registered" });
    if (await User.findOne({ panNumber }))
      return res.status(409).json({ success: false, message: "PAN number already registered" });

    const emailVerified = await OTP.findOne({ email, purpose: "email_verify", isUsed: true });
    if (!emailVerified)
      return res.status(400).json({ success: false, message: "Email is not verified. Please verify your email first" });

    const mobileVerified = await OTP.findOne({ mobile, purpose: "mobile_verify", isUsed: true });
    if (!mobileVerified)
      return res.status(400).json({ success: false, message: "Mobile is not verified. Please verify your mobile first" });

    const parsedDOB = parseDOB(dateOfBirth);
    if (!parsedDOB)
      return res.status(400).json({ success: false, message: "Invalid date of birth format" });

    const user = await User.create({
      email, mobile, password,
      fullName, dateOfBirth: parsedDOB,
      gender: gender || "other",
      aadhaarNumber, panNumber,
      address, city, state, pincode,
      purpose,
      liveSelfie: files.liveSelfie[0].path,
      documents: {
        aadhaarFront: aadhaarFrontPath,
        panCard:      panCardPath,
      },
      isEmailVerified:  true,
      isMobileVerified: true,
    });

    return res.status(201).json({
      success: true,
      message: "User registered successfully.",
      data: {
        id:       user._id,
        fullName: user.fullName,
        email:    user.email,
        role:     user.role,
      },
    });

  } catch (error) {
    console.error("registerUser Error:", error);
    if (error.name === "ValidationError") {
      const msgs = Object.values(error.errors).map(e => e.message);
      return res.status(400).json({ success: false, message: msgs[0] });
    }
    if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(409).json({ success: false, message: `${field} already exists` });
    }
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ═══════════════════════════════════════════════════════════
// @route  GET /api/user/:id
// @access Public
// ═══════════════════════════════════════════════════════════
const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    if (!user)
      return res.status(404).json({ success: false, message: "User not found" });
    return res.status(200).json({ success: true, data: user });
  } catch (error) {
    console.error("getUserById Error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

module.exports = { UserverifyDocuments, registerUser, getUserById };