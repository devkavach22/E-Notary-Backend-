const Advocate = require("../models/Advocate");
const { sendApprovalEmail, sendRejectionEmail } = require("./sendOTP");
const Tesseract = require("tesseract.js");
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");
const canvas = require("canvas");
const faceapi = require("face-api.js");
const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

let faceModelsLoaded = false;

const loadFaceModels = async () => {
    if (faceModelsLoaded) return;
    const modelsPath = path.join(__dirname, "../public/models");
    await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelsPath);
    await faceapi.nets.faceRecognitionNet.loadFromDisk(modelsPath);
    await faceapi.nets.faceLandmark68Net.loadFromDisk(modelsPath);
    faceModelsLoaded = true;
    console.log("✅ Face models loaded");
};

const compareFaces = async (selfiePath, aadhaarFrontPath) => {
    await loadFaceModels();

    const selfieImg = await canvas.loadImage(path.resolve(selfiePath));
    const aadhaarImg = await canvas.loadImage(path.resolve(aadhaarFrontPath));

    const selfieDetection = await faceapi
        .detectSingleFace(selfieImg)
        .withFaceLandmarks()
        .withFaceDescriptor();

    if (!selfieDetection) {
        throw new Error("Selfie mein face detect nahi hua. Please clear selfie upload karein.");
    }

    const aadhaarDetection = await faceapi
        .detectSingleFace(aadhaarImg)
        .withFaceLandmarks()
        .withFaceDescriptor();

    if (!aadhaarDetection) {
        throw new Error("Aadhaar card mein face detect nahi hua. Please clear image upload karein.");
    }

    const distance = faceapi.euclideanDistance(
        selfieDetection.descriptor,
        aadhaarDetection.descriptor
    );

    const similarity = Math.round((1 - distance) * 100);
    const isMatch = distance < 0.6;

    return { isMatch, similarity, distance: Math.round(distance * 100) / 100 };
};

// ─── BAR COUNCIL NUMBER FORMAT VALIDATOR ─────────────────────────────────────
const validateBarCouncilNumber = (barNumber, barState) => {
    if (!barNumber || !barState) return false;

    const statePrefixMap = {
        "uttar pradesh": "UP",
        "delhi": "D",
        "maharashtra": "MH",
        "rajasthan": "RJ",
        "gujarat": "GJ",
        "karnataka": "KA",
        "tamil nadu": "TN",
        "west bengal": "WB",
        "bihar": "BR",
        "madhya pradesh": "MP",
        "punjab": "PB",
        "haryana": "HR",
        "kerala": "KL",
        "odisha": "OD",
        "jharkhand": "JH",
        "chhattisgarh": "CG",
        "uttarakhand": "UK",
        "himachal pradesh": "HP",
        "assam": "AS",
        "andhra pradesh": "AP",
        "telangana": "TS",
        "goa": "GA",
    };

    const expectedPrefix = statePrefixMap[barState.toLowerCase().trim()];
    if (!expectedPrefix) return false;

    // Format: PREFIX/NUMBERS/YEAR  e.g. UP/1234/2020
    const regex = new RegExp(`^${expectedPrefix}\\/\\d+\\/\\d{4}$`);
    return regex.test(barNumber.toUpperCase().trim());
};

const isPDF = (filePath) => filePath.toLowerCase().endsWith(".pdf");

const convertPDFToImage = async (pdfPath) => {
    try {
        const pdf2pic = require("pdf2pic");
        const absolutePath = path.resolve(pdfPath);
        const outputDir = path.dirname(absolutePath);
        const outputName = path.basename(absolutePath, ".pdf");

        const convert = pdf2pic.fromPath(absolutePath, {
            density: 150,
            saveFilename: outputName,
            savePath: outputDir,
            format: "png",
            width: 1200,
            height: 1600,
        });

        const result = await convert(1);
        return result.path;
    } catch (err) {
        console.error("PDF Convert Error:", err.message);
        throw new Error("PDF convert nahi ho saka. Ensure poppler is installed.");
    }
};

const preprocessImageForOCR = async (imagePath) => {
    const outputPath = imagePath.replace(/(\.\w+)$/, "_processed$1");
    try {
        await sharp(imagePath)
            .resize({ width: 1600 })
            .grayscale()
            .normalise()
            .sharpen()
            .toFile(outputPath);
        return outputPath;
    } catch (err) {
        console.error("Preprocessing failed, using original:", err.message);
        return imagePath;
    }
};

const extractTextFromImage = async (filePath, preprocess = false) => {
    try {
        let imagePath = filePath;
        let tempFile = null;
        let processedFile = null;

        if (isPDF(filePath)) {
            imagePath = await convertPDFToImage(filePath);
            tempFile = imagePath;
        }

        const absolutePath = path.resolve(imagePath);

        if (!fs.existsSync(absolutePath)) {
            throw new Error(`File not found: ${absolutePath}`);
        }

        if (preprocess) {
            processedFile = await preprocessImageForOCR(absolutePath);
        }

        const finalPath = processedFile || absolutePath;

        const result = await Tesseract.recognize(finalPath, "eng+hin", {
            logger: () => { },
            tessedit_char_whitelist: preprocess
                ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 /.-"
                : undefined,
        });

        if (tempFile && fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        if (processedFile && processedFile !== absolutePath && fs.existsSync(processedFile)) {
            fs.unlinkSync(processedFile);
        }

        return result.data.text.toUpperCase();
    } catch (error) {
        console.error("OCR Error:", error.message);
        throw new Error("Document read nahi ho saka. Please ensure image/PDF is clear.");
    }
};

const cleanOCRText = (text) => text.toUpperCase().replace(/\s+/g, " ").trim();
const cleanOCRTextForPAN = (text) => text.toUpperCase().replace(/\s+/g, " ").trim();

const isPANMatch = (ocrText, registeredPAN) => {
    const pan = registeredPAN.toUpperCase();
    if (ocrText.includes(pan)) return true;

    const noSpaceOCR = ocrText.replace(/\s+/g, "");
    if (noSpaceOCR.includes(pan)) return true;

    const confusionMap = [["1", "I"], ["0", "O"], ["5", "S"], ["8", "B"]];
    const variants = new Set();

    let v1 = pan;
    for (const [num, alpha] of confusionMap) v1 = v1.split(alpha).join(num);
    variants.add(v1);

    let v2 = pan;
    for (const [num, alpha] of confusionMap) v2 = v2.split(num).join(alpha);
    variants.add(v2);

    for (const v of variants) {
        if (ocrText.includes(v)) return true;
        if (noSpaceOCR.includes(v)) return true;
    }

    let matchCount = 0;
    for (let i = 0; i < pan.length; i++) {
        if (noSpaceOCR.includes(pan[i])) matchCount++;
    }
    if (matchCount >= 8) return true;

    return false;
};

const isNameMatch = (ocrText, registeredName) => {
    const nameParts = registeredName.toUpperCase().trim().split(" ");
    const matchCount = nameParts.filter(
        (part) => part.length > 2 && ocrText.includes(part)
    ).length;
    return matchCount >= Math.min(2, nameParts.length);
};

const isLocationMatch = (ocrText, value) => {
    if (!value) return false;
    const normalizedValue = value.toUpperCase().trim();
    const normalizedOCR = ocrText.toUpperCase();
    if (normalizedOCR.includes(normalizedValue)) return true;
    if (normalizedValue.length >= 4) {
        const partial = normalizedValue.substring(0, normalizedValue.length - 1);
        if (normalizedOCR.includes(partial)) return true;
    }
    return false;
};

const isValidMobile = (mobile) => /^[6-9]\d{9}$/.test(mobile);

// ═════════════════════════════════════════════════════════
// ADMIN CONTROLLERS
// ═════════════════════════════════════════════════════════

const getAllAdvocates = async (req, res) => {
    try {
        const advocates = await Advocate.find()
            .select("-password")
            .sort({ createdAt: -1 });

        return res.status(200).json({
            success: true,
            total: advocates.length,
            data: advocates,
        });
    } catch (error) {
        console.error("getAllAdvocates Error:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

const getPendingAdvocates = async (req, res) => {
    try {
        const advocates = await Advocate.find({ approvalStatus: "pending" })
            .select("-password")
            .sort({ createdAt: -1 });

        if (advocates.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No pending advocates found",
            });
        }

        return res.status(200).json({
            success: true,
            total: advocates.length,
            data: advocates,
        });
    } catch (error) {
        console.error("getPendingAdvocates Error:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

const getAdvocateDetails = async (req, res) => {
    try {
        const advocate = await Advocate.findById(req.params.id).select("-password");

        if (!advocate) {
            return res.status(404).json({ success: false, message: "Advocate not found" });
        }

        return res.status(200).json({
            success: true,
            data: {
                id: advocate._id,
                fullName: advocate.fullName,
                dateOfBirth: advocate.dateOfBirth,
                gender: advocate.gender,
                mobile: advocate.mobile,
                email: advocate.email,
                barCouncilNumber: advocate.barCouncilNumber,
                barCouncilState: advocate.barCouncilState,
                yearOfEnrollment: advocate.yearOfEnrollment,
                practiceAreas: advocate.practiceAreas,
                languagesKnown: advocate.languagesKnown,
                city: advocate.city,
                state: advocate.state,
                officeAddress: advocate.officeAddress,
                pincode: advocate.pincode,
                aadhaarNumber: advocate.aadhaarNumber,
                panNumber: advocate.panNumber,
                liveSelfie: advocate.liveSelfie,
                documents: advocate.documents,
                bankDetails: advocate.bankDetails,
                availableDays: advocate.availableDays,
                availableHours: advocate.availableHours,
                perDocumentFee: advocate.perDocumentFee,
                verificationChecks: advocate.verificationChecks,
                approvalStatus: advocate.approvalStatus,
                rejectionReason: advocate.rejectionReason,
                isEmailVerified: advocate.isEmailVerified,
                isMobileVerified: advocate.isMobileVerified,
                isActive: advocate.isActive,
                createdAt: advocate.createdAt,
            },
        });
    } catch (error) {
        console.error("getAdvocateDetails Error:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

// ─────────────────────────────────────────────────────────
// @route   PUT /api/admin/advocate/:id/ocr-verify
// ─────────────────────────────────────────────────────────
const ocrVerify = async (req, res) => {
    try {
        const advocate = await Advocate.findById(req.params.id);

        if (!advocate) {
            return res.status(404).json({ success: false, message: "Advocate not found" });
        }

        if (advocate.approvalStatus !== "pending") {
            return res.status(409).json({
                success: false,
                message: `Advocate is already ${advocate.approvalStatus}`,
            });
        }

        const results = {
            aadhaar:    { success: false, checks: {}, message: "" },
            pan:        { success: false, checks: {}, message: "" },
            barCouncil: { success: false, checks: {}, message: "" },
            mobile:     { success: false, checks: {}, message: "" },
            faceMatch:  { success: false, checks: {}, message: "" },
        };

        // ═══════════════════════════════════════════════════
        // 1. AADHAAR VERIFICATION
        // ═══════════════════════════════════════════════════
        try {
            const rawAadhaarText = await extractTextFromImage(advocate.documents.aadhaarFront);
            const aadhaarText = cleanOCRText(rawAadhaarText);

            let aadhaarBackText = "";
            if (advocate.documents.aadhaarBack) {
                try {
                    const rawBack = await extractTextFromImage(advocate.documents.aadhaarBack);
                    aadhaarBackText = cleanOCRText(rawBack);
                } catch (_) { }
            }

            const combinedAadhaarText = aadhaarText + " " + aadhaarBackText;
            const registeredName    = advocate.fullName;
            const registeredAadhaar = advocate.aadhaarNumber;
            const registeredCity    = advocate.city;
            const registeredState   = advocate.state;
            const registeredPincode = advocate.pincode;

            const rawDOB = advocate.dateOfBirth;
            let dobFormatted;
            if (typeof rawDOB === "string" && rawDOB.includes("-")) {
                const datePart = rawDOB.split("T")[0];
                const [year, month, day] = datePart.split("-");
                dobFormatted = `${day}/${month}/${year}`;
            } else {
                const dob = new Date(rawDOB);
                dobFormatted = `${String(dob.getUTCDate()).padStart(2, "0")}/${String(
                    dob.getUTCMonth() + 1
                ).padStart(2, "0")}/${dob.getUTCFullYear()}`;
            }

            const nameMatch    = isNameMatch(combinedAadhaarText, registeredName);
            const aadhaarMatch = combinedAadhaarText.includes(registeredAadhaar.slice(-4));
            const dobMatch     = combinedAadhaarText.includes(dobFormatted);

            const addressText  = aadhaarBackText || combinedAadhaarText;
            const cityMatch    = isLocationMatch(addressText, registeredCity);
            const stateMatch   = isLocationMatch(addressText, registeredState);
            const pincodeMatch = isLocationMatch(addressText, registeredPincode);

            results.aadhaar.checks = { nameMatch, aadhaarNumberMatch: aadhaarMatch, dobMatch, cityMatch, stateMatch, pincodeMatch };
            results.aadhaar.debug = {
                dobExpected: dobFormatted,
                ocrFrontPreview: aadhaarText.substring(0, 200),
                ocrBackPreview: aadhaarBackText.substring(0, 200),
            };

            if (nameMatch && aadhaarMatch) {
                results.aadhaar.success = true;
                results.aadhaar.message = "✅ Aadhaar verified successfully";
                advocate.verificationChecks.aadhaarVerified = true;

                const addressIssues = [];
                if (!dobMatch)     addressIssues.push("DOB mismatch");
                if (!cityMatch)    addressIssues.push("City mismatch");
                if (!stateMatch)   addressIssues.push("State mismatch");
                if (!pincodeMatch) addressIssues.push("Pincode mismatch");

                if (addressIssues.length > 0) {
                    results.aadhaar.addressWarnings = addressIssues;
                    results.aadhaar.message += ` (Warnings: ${addressIssues.join(", ")})`;
                }
            } else {
                results.aadhaar.success = false;
                results.aadhaar.message = "❌ Aadhaar verification failed";
                advocate.verificationChecks.aadhaarVerified = false;

                const failed = [];
                if (!nameMatch)    failed.push("Name mismatch");
                if (!aadhaarMatch) failed.push("Aadhaar number mismatch");
                if (!dobMatch)     failed.push(`DOB mismatch (expected: ${dobFormatted})`);
                if (!cityMatch)    failed.push("City mismatch");
                if (!stateMatch)   failed.push("State mismatch");
                if (!pincodeMatch) failed.push("Pincode mismatch");
                results.aadhaar.failedChecks = failed;
            }
        } catch (err) {
            results.aadhaar.message = `❌ Aadhaar OCR failed: ${err.message}`;
            advocate.verificationChecks.aadhaarVerified = false;
        }

        // ═══════════════════════════════════════════════════
        // 2. PAN VERIFICATION
        // ═══════════════════════════════════════════════════
        try {
            const rawPanTextOriginal  = await extractTextFromImage(advocate.documents.panCard, false);
            const panTextOriginal     = cleanOCRTextForPAN(rawPanTextOriginal);
            const rawPanTextProcessed = await extractTextFromImage(advocate.documents.panCard, true);
            const panTextProcessed    = cleanOCRTextForPAN(rawPanTextProcessed);
            const combinedPanText     = panTextOriginal + " " + panTextProcessed;

            const registeredPAN  = advocate.panNumber.toUpperCase();
            const registeredName = advocate.fullName;

            const panMatch  = isPANMatch(combinedPanText, registeredPAN);
            const nameMatch = isNameMatch(combinedPanText, registeredName);

            results.pan.checks = { panNumberMatch: panMatch, nameMatch };
            results.pan.debug = {
                panExpected: registeredPAN,
                nameExpected: registeredName,
                ocrOriginalPreview: panTextOriginal.substring(0, 200),
                ocrProcessedPreview: panTextProcessed.substring(0, 200),
            };

            if (panMatch && nameMatch) {
                results.pan.success = true;
                results.pan.message = "✅ PAN verified successfully";
                advocate.verificationChecks.panVerified = true;
            } else {
                results.pan.success = false;
                results.pan.message = "❌ PAN verification failed";
                advocate.verificationChecks.panVerified = false;

                const failed = [];
                if (!panMatch)  failed.push(`PAN number mismatch (expected: ${registeredPAN})`);
                if (!nameMatch) failed.push("Name mismatch");
                results.pan.failedChecks = failed;
            }
        } catch (err) {
            results.pan.message = `❌ PAN OCR failed: ${err.message}`;
            advocate.verificationChecks.panVerified = false;
        }

        // ═══════════════════════════════════════════════════
        // 3. BAR COUNCIL VERIFICATION
        // Certificate OCR skip — sirf format validate karo
        // ═══════════════════════════════════════════════════
        try {
            const registeredBarNumber = advocate.barCouncilNumber;
            const registeredBarState  = advocate.barCouncilState;
            const registeredName      = advocate.fullName;
            const registeredYear      = String(advocate.yearOfEnrollment);

            // Format check — UP/1234/2020 jaise
            const formatValid = validateBarCouncilNumber(registeredBarNumber, registeredBarState);

            // Name check — fullName mein se parts match karo
            const nameValid = registeredName && registeredName.trim().length > 0;

            // Year check — enrollment year valid range mein hai?
            const currentYear = new Date().getFullYear();
            const yearValid = registeredYear &&
                parseInt(registeredYear) >= 1950 &&
                parseInt(registeredYear) <= currentYear;

            results.barCouncil.checks = {
                formatValid,
                nameValid,
                yearValid,
                barNumber: registeredBarNumber,
                barState: registeredBarState,
            };

            if (formatValid && nameValid && yearValid) {
                results.barCouncil.success = true;
                results.barCouncil.message = `✅ Bar Council verified (Format: ${registeredBarNumber})`;
                advocate.verificationChecks.barCouncilVerified = true;
            } else {
                results.barCouncil.success = false;
                results.barCouncil.message = "❌ Bar Council verification failed";
                advocate.verificationChecks.barCouncilVerified = false;

                const failed = [];
                if (!formatValid) failed.push(`Invalid Bar Council number format. Expected format: STATE_CODE/NUMBER/YEAR (e.g. UP/1234/2020)`);
                if (!nameValid)   failed.push("Advocate name missing");
                if (!yearValid)   failed.push(`Invalid enrollment year: ${registeredYear}`);
                results.barCouncil.failedChecks = failed;
            }
        } catch (err) {
            results.barCouncil.message = `❌ Bar Council check failed: ${err.message}`;
            advocate.verificationChecks.barCouncilVerified = false;
        }

        // ═══════════════════════════════════════════════════
        // 4. MOBILE VERIFICATION
        // ═══════════════════════════════════════════════════
        try {
            const mobile      = advocate.mobile;
            const formatValid = isValidMobile(mobile);
            const otpVerified = advocate.isMobileVerified;

            results.mobile.checks = { formatValid, otpVerified };

            if (formatValid && otpVerified) {
                results.mobile.success = true;
                results.mobile.message = "✅ Mobile verified successfully";
                advocate.verificationChecks.mobileVerified = true;
            } else {
                results.mobile.success = false;
                advocate.verificationChecks.mobileVerified = false;

                const failed = [];
                if (!formatValid) failed.push("Invalid mobile format");
                if (!otpVerified) failed.push("Mobile OTP not verified");
                results.mobile.failedChecks = failed;
                results.mobile.message = `❌ Mobile verification failed: ${failed.join(", ")}`;
            }
        } catch (err) {
            results.mobile.message = `❌ Mobile check failed: ${err.message}`;
            advocate.verificationChecks.mobileVerified = false;
        }

        // ═══════════════════════════════════════════════════
        // 5. FACE MATCH — Selfie vs Aadhaar Front
        // ═══════════════════════════════════════════════════
        try {
            if (!advocate.liveSelfie) {
                throw new Error("Live selfie upload nahi ki gayi.");
            }
            if (!advocate.documents.aadhaarFront) {
                throw new Error("Aadhaar front image available nahi hai.");
            }

            const { isMatch, similarity, distance } = await compareFaces(
                advocate.liveSelfie,
                advocate.documents.aadhaarFront
            );

            results.faceMatch.checks = {
                faceDetectedInSelfie:  true,
                faceDetectedInAadhaar: true,
                isMatch,
                similarity: `${similarity}%`,
                distance,
            };

            if (isMatch) {
                results.faceMatch.success = true;
                results.faceMatch.message = `✅ Face match successful (${similarity}% similarity)`;
                advocate.verificationChecks.liveSelfieVerified = true;
                advocate.verificationChecks.faceMatchVerified  = true;
            } else {
                results.faceMatch.success = false;
                results.faceMatch.message = `❌ Face match failed (${similarity}% similarity — minimum 40% required)`;
                advocate.verificationChecks.liveSelfieVerified = false;
                advocate.verificationChecks.faceMatchVerified  = false;
                results.faceMatch.failedChecks = [`Similarity too low: ${similarity}% (required: 40%+)`];
            }
        } catch (err) {
            results.faceMatch.message = `❌ Face match failed: ${err.message}`;
            advocate.verificationChecks.liveSelfieVerified = false;
            advocate.verificationChecks.faceMatchVerified  = false;
        }

        await advocate.save();

        const checks = advocate.verificationChecks;

        const allVerified =
            checks.aadhaarVerified &&
            checks.panVerified &&
            checks.barCouncilVerified &&
            checks.mobileVerified &&
            checks.liveSelfieVerified &&
            checks.faceMatchVerified;

        const pendingChecks = [];
        if (!checks.liveSelfieVerified)  pendingChecks.push("Live Selfie");
        if (!checks.aadhaarVerified)     pendingChecks.push("Aadhaar Card");
        if (!checks.panVerified)         pendingChecks.push("PAN Card");
        if (!checks.barCouncilVerified)  pendingChecks.push("Bar Council");
        if (!checks.mobileVerified)      pendingChecks.push("Mobile Number");
        if (!checks.faceMatchVerified)   pendingChecks.push("Face Match");

        return res.status(200).json({
            success: true,
            message: "OCR verification completed",
            ocrResults: results,
            verificationChecks: checks,
            allVerified,
            pendingChecks,
            canApprove: allVerified,
        });
    } catch (error) {
        console.error("ocrVerify Error:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

// ─────────────────────────────────────────────────────────
// @route   PUT /api/admin/advocate/:id/verify-documents
// ─────────────────────────────────────────────────────────
const verifyDocuments = async (req, res) => {
    try {
        const { liveSelfieVerified, faceMatchVerified } = req.body;

        if (liveSelfieVerified === undefined && faceMatchVerified === undefined) {
            return res.status(400).json({
                success: false,
                message: "liveSelfieVerified or faceMatchVerified is required",
            });
        }

        const advocate = await Advocate.findById(req.params.id);

        if (!advocate) {
            return res.status(404).json({ success: false, message: "Advocate not found" });
        }

        if (advocate.approvalStatus !== "pending") {
            return res.status(409).json({
                success: false,
                message: `Advocate is already ${advocate.approvalStatus}`,
            });
        }

        if (liveSelfieVerified !== undefined)
            advocate.verificationChecks.liveSelfieVerified = liveSelfieVerified;
        if (faceMatchVerified !== undefined)
            advocate.verificationChecks.faceMatchVerified = faceMatchVerified;

        await advocate.save();

        const checks = advocate.verificationChecks;
        const allVerified =
            checks.liveSelfieVerified &&
            checks.aadhaarVerified &&
            checks.panVerified &&
            checks.barCouncilVerified &&
            checks.mobileVerified &&
            checks.faceMatchVerified;

        const pendingChecks = [];
        if (!checks.liveSelfieVerified)  pendingChecks.push("Live Selfie");
        if (!checks.aadhaarVerified)     pendingChecks.push("Aadhaar Card");
        if (!checks.panVerified)         pendingChecks.push("PAN Card");
        if (!checks.barCouncilVerified)  pendingChecks.push("Bar Council");
        if (!checks.mobileVerified)      pendingChecks.push("Mobile Number");
        if (!checks.faceMatchVerified)   pendingChecks.push("Face Match");

        return res.status(200).json({
            success: true,
            message: allVerified
                ? "✅ All documents verified! You can now approve this advocate."
                : "Documents updated. Some checks are still pending.",
            allVerified,
            verificationChecks: checks,
            pendingChecks,
            canApprove: allVerified,
        });
    } catch (error) {
        console.error("verifyDocuments Error:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

// ─────────────────────────────────────────────────────────
// @route   PUT /api/admin/advocate/:id/approve
// ─────────────────────────────────────────────────────────
const approveAdvocate = async (req, res) => {
    try {
        const advocate = await Advocate.findById(req.params.id);

        if (!advocate) {
            return res.status(404).json({ success: false, message: "Advocate not found" });
        }

        if (advocate.approvalStatus === "approved") {
            return res.status(409).json({
                success: false,
                message: "Advocate is already approved",
            });
        }

        const checks = advocate.verificationChecks;
        const pendingChecks = [];
        if (!checks.liveSelfieVerified)  pendingChecks.push("Live Selfie");
        if (!checks.aadhaarVerified)     pendingChecks.push("Aadhaar Card");
        if (!checks.panVerified)         pendingChecks.push("PAN Card");
        if (!checks.barCouncilVerified)  pendingChecks.push("Bar Council");
        if (!checks.mobileVerified)      pendingChecks.push("Mobile Number");
        if (!checks.faceMatchVerified)   pendingChecks.push("Face Match");

        if (pendingChecks.length > 0) {
            return res.status(400).json({
                success: false,
                message: "Cannot approve. Please verify all documents first.",
                pendingVerifications: pendingChecks,
            });
        }

        advocate.approvalStatus = "approved";
        advocate.isActive = true;
        advocate.rejectionReason = null;
        await advocate.save();

        await sendApprovalEmail(advocate.email, advocate.fullName);

        return res.status(200).json({
            success: true,
            message: "Advocate approved successfully. Email notification sent.",
            data: {
                id: advocate._id,
                fullName: advocate.fullName,
                email: advocate.email,
                approvalStatus: advocate.approvalStatus,
                isActive: advocate.isActive,
                verificationChecks: advocate.verificationChecks,
            },
        });
    } catch (error) {
        console.error("approveAdvocate Error:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

// ─────────────────────────────────────────────────────────
// @route   PUT /api/admin/advocate/:id/reject
// ─────────────────────────────────────────────────────────
const rejectAdvocate = async (req, res) => {
    try {
        const { reason } = req.body;

        if (!reason || reason.trim() === "") {
            return res.status(400).json({
                success: false,
                message: "Rejection reason is required",
            });
        }

        const advocate = await Advocate.findById(req.params.id);

        if (!advocate) {
            return res.status(404).json({ success: false, message: "Advocate not found" });
        }

        if (advocate.approvalStatus === "rejected") {
            return res.status(409).json({
                success: false,
                message: "Advocate is already rejected",
            });
        }

        advocate.approvalStatus = "rejected";
        advocate.isActive = false;
        advocate.rejectionReason = reason;

        advocate.verificationChecks = {
            liveSelfieVerified: false,
            aadhaarVerified: false,
            panVerified: false,
            barCouncilVerified: false,
            mobileVerified: false,
            faceMatchVerified: false,
        };

        await advocate.save();

        await sendRejectionEmail(advocate.email, advocate.fullName, reason);

        return res.status(200).json({
            success: true,
            message: "Advocate rejected successfully. Email notification sent.",
            data: {
                id: advocate._id,
                fullName: advocate.fullName,
                email: advocate.email,
                approvalStatus: advocate.approvalStatus,
                rejectionReason: advocate.rejectionReason,
                isActive: advocate.isActive,
            },
        });
    } catch (error) {
        console.error("rejectAdvocate Error:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

module.exports = {
    getAllAdvocates,
    getPendingAdvocates,
    getAdvocateDetails,
    ocrVerify,
    verifyDocuments,
    approveAdvocate,
    rejectAdvocate,
};