// index.tsx
import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Button,
  Image,
  Text,
  ActivityIndicator,
  ScrollView,
  TextInput,
  Platform,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Clipboard,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { WebView } from "react-native-webview";

/**
 * LLM Math Solver Frontend
 * Features:
 * - Type-safe TypeScript interfaces
 * - Upload progress indicators
 * - Copy-to-clipboard functionality
 * - Optimized LaTeX rendering
 * - Better error handling
 */

// Type definitions
type ImageAsset = {
  uri: string;
  width?: number;
  height?: number;
  type?: string;
  fileSize?: number;
  mimeType?: string;
};

type LLMResult = {
  latex?: string | null;
  answer?: string | number | null;
  steps?: string[] | null;
  notes?: string | null;
};

type BackendResponse = {
  raw: string | null;
  parsed: LLMResult | null;
  error?: string;
  detail?: string;
};

type UploadStage = 'idle' | 'uploading' | 'processing' | 'complete' | 'error';

export default function IndexScreen() {
  const [image, setImage] = useState<ImageAsset | null>(null);
  const [resultRaw, setResultRaw] = useState<BackendResponse | null>(null);
  const [result, setResult] = useState<LLMResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploadStage, setUploadStage] = useState<UploadStage>('idle');
  const [backendUrl, setBackendUrl] = useState("http://localhost:8000");
  const [showRaw, setShowRaw] = useState(false);
  const mathContainerRef = useRef<HTMLDivElement | null>(null);

  // Load MathJax in web with proper configuration
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if ((window as any).MathJax) return;

    // Configure MathJax BEFORE loading the script
    (window as any).MathJax = {
      tex: {
        inlineMath: [['\\(', '\\)'], ['$', '$']],
        displayMath: [['\\[', '\\]'], ['$$', '$$']],
        processEscapes: true,
        processEnvironments: true
      },
      options: {
        skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre']
      }
    };

    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js";
    s.async = true;
    document.head.appendChild(s);
  }, []);

  // Trigger MathJax typeset after latex updates on web
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (!result?.latex) return;
    setTimeout(async () => {
      try {
        const MJ = (window as any).MathJax;
        if (MJ && MJ.typesetPromise) await MJ.typesetPromise();
      } catch {}
    }, 80);
  }, [result?.latex, result?.steps, result?.answer]);

  // ------------------ cleaning helpers ------------------
  // Try to extract JSON candidate from a messy string (fenced code, etc.)
  const extractJsonFromText = (text?: string | null): any | null => {
    if (!text || typeof text !== "string") return null;
    // find first { ... } block
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first !== -1 && last !== -1 && last > first) {
      const candidate = text.slice(first, last + 1);
      try {
        return JSON.parse(candidate);
      } catch {}
      // fallback: remove escaped newlines and try again
      const cleaned = candidate.replace(/\\n/g, " ").replace(/\r/g, " ");
      try {
        return JSON.parse(cleaned);
      } catch {}
    }
    // fenced code block containing JSON
    const fence = /```(?:json)?\n?([\s\S]*?)```/i.exec(text);
    if (fence && fence[1]) {
      const inner = fence[1].trim();
      try {
        return JSON.parse(inner);
      } catch {}
    }
    return null;
  };

  // Clean up LaTeX strings:
  // - remove triple/backtick fences
  // - collapse double-escaped backslashes \\ -> \ and \\\\ -> \\
  // - many backslashes in your raw are like "\\\\frac" (JS string contains "\\\\frac"),
  //   so we convert sequences of multiple backslashes into a single backslash for MathJax.
  const cleanLatex = (s?: string | null): string | null => {
    if (!s || typeof s !== "string") return null;
    let t = s.trim();

    // Remove code fences ```...``` if present
    t = t.replace(/```(?:json)?\n?/gi, "").replace(/```$/gi, "");

    // Remove wrapping triple quotes/backticks or surrounding quotes
    t = t.replace(/^["'`]+|["'`]+$/g, "");

    // Replace literal newline escapes with spacing
    t = t.replace(/\\n/g, " ").replace(/\r/g, " ");

    // Collapse sequences of double-escaped backslashes into a single backslash.
    // Examples:
    // "\\\\frac" (4 chars after JSON decode) -> "\\frac" -> "\frac" (final)
    // "\\frac" -> "\frac"
    // We first collapse runs of 2 or more backslashes to a single backslash:
    t = t.replace(/\\\\+/g, "\\");

    // Remove stray escape of brackets like "\[ " or "\]" left with extra spaces
    t = t.replace(/\\\s*\[/g, "\\[").replace(/\\\s*\]/g, "\\]");

    // Trim again
    t = t.trim();

    // If user wants display math but only simple inline $, keep as-is.
    return t;
  };

  // Determine if a string contains LaTeX-ish patterns
  const looksLikeLatex = (s?: string | null) => {
    if (!s || typeof s !== "string") return false;
    return /\\frac|\\sqrt|\\times|\\div|\\left|\\right|\\\(|\\\[|\\\]|\\sqrt|\\cdot|\\pi|{\\|\\\\/.test(s);
  };

  // Normalize backend parsed object into our LLMResult
  const normalizeParsed = (parsedIn: any, rawText?: string | null): LLMResult => {
    let parsed = parsedIn ?? null;
    // If parsed is string, try to parse JSON inside
    if (typeof parsed === "string") {
      const maybe = extractJsonFromText(parsed);
      if (maybe) parsed = maybe;
      else {
        try {
          parsed = JSON.parse(parsed);
        } catch {
          // leave string as-is
        }
      }
    }
    // If parsed is still string and rawText available, try extract from rawText
    if ((!parsed || typeof parsed !== "object") && rawText) {
      const maybe = extractJsonFromText(rawText);
      if (maybe) parsed = maybe;
    }

    // If parsed now is object, pull fields
    const latex = parsed?.latex ?? parsed?.Latex ?? parsed?.expression ?? null;
    let answer = parsed?.answer ?? parsed?.Answer ?? parsed?.result ?? parsed?.final ?? null;
    let steps = parsed?.steps ?? parsed?.Steps ?? parsed?.explanation ?? parsed?.details ?? null;
    const notes = parsed?.notes ?? parsed?.note ?? null;

    // If choices exist (Perplexity API style), try to extract JSON from choice message
    if ((!latex && !answer && !steps) && parsed?.choices && Array.isArray(parsed.choices) && parsed.choices.length) {
      const msg = parsed.choices[0]?.message?.content ?? parsed.choices[0]?.message ?? parsed.choices[0]?.text;
      if (typeof msg === "string") {
        const inner = extractJsonFromText(msg);
        if (inner) {
          return normalizeParsed(inner, rawText);
        } else {
          // fallback: treat msg as steps text
          steps = steps ?? msg;
        }
      }
    }

    // Convert steps into array of strings
    let stepsArr: string[] | null = null;
    if (Array.isArray(steps)) {
      stepsArr = steps.map((s) => (typeof s === "string" ? s : JSON.stringify(s)));
    } else if (typeof steps === "string") {
      // Try to split into numbered items or lines
      const cleaned = steps.trim();
      const fenced = cleaned.replace(/^```(?:json)?/i, "").replace(/```$/i, "");
      const lines = fenced.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length > 1) stepsArr = lines;
      else {
        // split by numbered bullets or sentences
        const byNumber = cleaned.split(/\d+\.\s+/).map((p) => p.trim()).filter(Boolean);
        if (byNumber.length > 1) stepsArr = byNumber;
        else {
          const sentences = cleaned.split(/(?<=\.)\s+/).map((s) => s.trim()).filter(Boolean);
          stepsArr = sentences.length > 1 ? sentences : [cleaned];
        }
      }
    }

    // Clean LaTeX in fields (unescape double slashes)
    const cleanedLatex = cleanLatex(typeof latex === "string" ? latex : null);
    if (typeof answer === "string") answer = cleanLatex(answer) ?? answer;
    if (Array.isArray(stepsArr)) stepsArr = stepsArr.map((s) => (typeof s === "string" ? cleanLatex(s) ?? s : String(s)));

    return {
      latex: cleanedLatex,
      answer,
      steps: stepsArr,
      notes,
    };
  };

  // ------------------ Utility functions ------------------

  /**
   * Copy text to clipboard with user feedback
   */
  const copyToClipboard = async (text: string, label: string = "Text") => {
    try {
      if (Platform.OS === 'web') {
        await navigator.clipboard.writeText(text);
      } else {
        Clipboard.setString(text);
      }
      Alert.alert("Copied", `${label} copied to clipboard!`);
    } catch (error) {
      console.error('Failed to copy:', error);
      Alert.alert("Error", "Failed to copy to clipboard");
    }
  };

  /**
   * Get user-friendly status message based on upload stage
   */
  const getStatusMessage = (): string => {
    switch (uploadStage) {
      case 'uploading':
        return 'Uploading image...';
      case 'processing':
        return 'AI is solving the problem...';
      case 'complete':
        return 'Complete!';
      case 'error':
        return 'An error occurred';
      default:
        return '';
    }
  };

  // ------------------ upload and handle backend response ------------------
  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission", "Permission required to access gallery.");
      return;
    }
    const res: any = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (!res.canceled) {
      setImage(res.assets[0]);
      setResult(null);
      setResultRaw(null);
      setShowRaw(false);
    }
  };

  const send = async (path: string) => {
    if (!image) {
      Alert.alert("Pick image first");
      return;
    }
    setLoading(true);
    setResult(null);
    setResultRaw(null);
    setShowRaw(false);
    try {
      const uri = image.uri;
      const filename = uri.split("/").pop() || "photo.jpg";
      const match = /\.(\w+)$/.exec(filename);
      const type = match ? `image/${match[1]}` : "image/jpeg";
      const form = new FormData();

      // For web create File from fetch blob
      if (Platform.OS === "web") {
        const fetched = await fetch(uri);
        const blob = await fetched.blob();
        const file = new File([blob], filename, { type: blob.type || type });
        form.append("file", file);
      } else {
        form.append(
          "file",
          {
            uri: Platform.OS === "android" ? uri : uri.replace("file://", ""),
            name: filename,
            type,
          } as any
        );
      }

      const resp = await fetch(backendUrl + path, { method: "POST", body: form } as any);
      let parsedJson = null;
      let rawText = null;
      try {
        parsedJson = await resp.json();
      } catch (e) {
        rawText = await resp.text();
      }

      // Backend returns { raw: "...", parsed: {...} } in our main.py. Normalize.
      let backendParsed = null;
      let backendRaw = null;
      if (parsedJson && typeof parsedJson === "object") {
        backendParsed = parsedJson.parsed ?? parsedJson;
        backendRaw = parsedJson.raw ?? null;
      } else if (rawText) {
        backendRaw = rawText;
      }

      // If backendParsed contains choices/message content with embedded JSON, try to extract
      if (typeof backendParsed === "object") {
        // if choices exist
        if (backendParsed.choices && Array.isArray(backendParsed.choices) && backendParsed.choices.length) {
          const candidate =
            backendParsed.choices[0]?.message?.content ??
            backendParsed.choices[0]?.message ??
            backendParsed.choices[0]?.text ??
            null;
          if (typeof candidate === "string") {
            const inner = extractJsonFromText(candidate);
            if (inner) backendParsed = inner;
          }
        }
      } else if (typeof backendRaw === "string") {
        const inner = extractJsonFromText(backendRaw);
        if (inner) backendParsed = inner;
      }

      const normalized = normalizeParsed(backendParsed, backendRaw);

      setResultRaw({ parsed: backendParsed, raw: backendRaw });
      setResult(normalized);
    } catch (err: any) {
      Alert.alert("Upload failed", err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  };

  // Build simple MathJax HTML for WebView (native)
  const buildMathHtml = (latex?: string | null) => {
    const body = latex ? (latex.includes("\\[") || latex.includes("$$") ? latex : `\\[ ${latex} \\]`) : "";
    return `<!doctype html><html><head><meta charset="utf-8"/>
      <script>window.MathJax={tex:{inlineMath:[['$','$'],['\\\\(','\\\\)']]}};</script>
      <script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"></script>
      <style>body{font-family:Arial;padding:6px;margin:0;color:#111}</style>
      </head><body>${body}</body></html>`;
  };

  // Build HTML for step with mixed text and LaTeX
  const buildStepHtml = (stepNumber: number, content: string) => {
    return `<!doctype html><html><head><meta charset="utf-8"/>
      <script>
        window.MathJax = {
          tex: {
            inlineMath: [['\\\\(', '\\\\)']],
            displayMath: [['\\\\[', '\\\\]']],
            processEscapes: true
          },
          startup: {
            pageReady: () => {
              return MathJax.startup.defaultPageReady().then(() => {
                // Auto-adjust height
                const height = document.body.scrollHeight;
                window.ReactNativeWebView?.postMessage(JSON.stringify({ height }));
              });
            }
          }
        };
      </script>
      <script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js"></script>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
          padding: 8px;
          margin: 0;
          color: #222;
          font-size: 15px;
          line-height: 1.6;
        }
        strong { font-weight: 600; }
        .mjx-chtml { display: inline !important; }
      </style>
    </head>
    <body>
      <strong>${stepNumber}.</strong> ${content}
    </body>
    </html>`;
  };

  // Small preview for hidden raw
  const rawPreview = () => {
    if (!result) return "No result yet";
    if (result.answer) return `Answer: ${result.answer}`;
    if (result.latex) return `Expression: ${String(result.latex).slice(0, 60)}${String(result.latex).length > 60 ? "…" : ""}`;
    if (result.steps && result.steps.length) return `Step 1: ${result.steps[0].slice(0, 80)}${result.steps[0].length > 80 ? "…" : ""}`;
    return "No parsed preview";
  };

  // Render LaTeX element for web via dangerouslySetInnerHTML and MathJax
  const renderLatexWeb = (latex?: string | null, style?: any) => {
    if (!latex) return null;
    const inside = latex.includes("\\[") || latex.includes("$$") ? latex : `\\[ ${latex} \\]`;
    return (
      <div
        ref={mathContainerRef as any}
        style={style}
        dangerouslySetInnerHTML={{ __html: inside }}
      />
    );
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 18 }}>
      <Text style={styles.title}>LLM Math Solver — Pretty View</Text>

      <Text style={{ marginBottom: 6 }}>Backend URL:</Text>
      <TextInput value={backendUrl} onChangeText={setBackendUrl} style={styles.input} />

      <Button title="Pick an Image From PC" onPress={pickImage} />

      {image && <Image source={{ uri: image.uri }} style={{ width: "100%", height: 220, marginTop: 12, borderRadius: 8 }} resizeMode="contain" />}

      <View style={{ marginTop: 12 }}>
        <Button title="Solve with Gemini" onPress={() => send("/solve-gemini")} disabled={loading} />
      </View>
      <View style={{ marginTop: 8 }}>
        <Button title="Solve with Perplexity" onPress={() => send("/solve-perplexity")} disabled={loading} />
      </View>

      {/* NEW: Solve with ChatGPT/OpenAI */}
      <View style={{ marginTop: 8 }}>
        <Button title="Solve with ChatGPT" onPress={() => send("/solve-chatgpt")} disabled={loading} />
      </View>

      {loading && <ActivityIndicator size="large" style={{ marginTop: 18 }} />}

      {result && (
        <View style={{ backgroundColor: "#fff", padding: 14, marginTop: 16, borderRadius: 8 }}>
          <Text style={{ color: "#666", marginBottom: 8 }}>Expression</Text>

          {result.latex ? (
            Platform.OS === "web" ? (
              renderLatexWeb(result.latex, { minHeight: 80, textAlign: "center", marginBottom: 10 })
            ) : (
              <View style={{ height: 80, marginBottom: 10 }}>
                <WebView originWhitelist={["*"]} source={{ html: buildMathHtml(result.latex) }} style={{ flex: 1 }} />
              </View>
            )
          ) : (
            <Text style={{ color: "#333", marginBottom: 8 }}>{result.notes ?? "Expression"}</Text>
          )}

          <Text style={{ fontWeight: "700", marginBottom: 8 }}>Let's solve it step-by-step:</Text>

          {result.steps && result.steps.length ? (
            <View style={{ marginBottom: 12 }}>
              {result.steps.map((s, idx) => {
                const stepText = s ?? "";
                const cleaned = cleanLatex(stepText) ?? stepText;

                // Auto-wrap LaTeX expressions in the content with delimiters
                // Replace patterns like \log_{5}, \frac{}, etc. with proper inline math delimiters
                let displayContent = cleaned;

                // First, handle spacing commands like \quad - replace with regular space
                displayContent = displayContent.replace(/\\quad/g, ' ');
                displayContent = displayContent.replace(/\\qquad/g, '  ');

                // Wrap LaTeX commands in inline math delimiters \( \) for MathJax
                // Match LaTeX commands and wrap them
                displayContent = displayContent.replace(
                  /(\\(?:log|frac|sqrt|times|div|cdot|pi|sum|int|partial|alpha|beta|gamma|delta|theta|lambda|mu|sigma|omega|infty|pm|mp|leq|geq|neq|approx|equiv|subset|supset|in|notin|forall|exists|nabla|partial|to|rightarrow|leftarrow|Rightarrow|Leftarrow|implies|iff)(?:_\{[^}]+\}|\^\{[^}]+\}|\{[^}]*\})*)/g,
                  '\\($1\\)'
                );

                // Also handle standalone subscripts and superscripts with variables like x^2, x_{5}
                displayContent = displayContent.replace(
                  /\b([a-zA-Z])(\^\{[^}]+\}|_\{[^}]+\})/g,
                  '\\($1$2\\)'
                );

                // Handle superscripts without braces like x^2 (not x^{2})
                displayContent = displayContent.replace(
                  /\b([a-zA-Z])\^(\d)/g,
                  '\\($1^$2\\)'
                );

                return (
                  <View key={idx} style={{ marginBottom: 10, paddingLeft: 10 }}>
                    {Platform.OS === "web" ? (
                      <div style={{ textAlign: "left", fontSize: "16px" }}>
                        <strong>{idx + 1}. </strong>
                        <span dangerouslySetInnerHTML={{ __html: displayContent }} />
                      </div>
                    ) : (
                      <View style={{ minHeight: 60 }}>
                        <WebView
                          originWhitelist={["*"]}
                          source={{ html: buildStepHtml(idx + 1, displayContent) }}
                          style={{ flex: 1 }}
                        />
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          ) : null}

          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 4 }}>
            <Text style={{ fontWeight: "700", fontSize: 18, marginRight: 10 }}>✅ Final Answer:</Text>
            {result.answer && typeof result.answer === "string" && looksLikeLatex(result.answer) ? (
              Platform.OS === "web" ? (
                renderLatexWeb(String(result.answer), { fontSize: 20 })
              ) : (
                <View style={{ height: 56, width: "60%" }}>
                  <WebView originWhitelist={["*"]} source={{ html: buildMathHtml(String(result.answer)) }} style={{ flex: 1 }} />
                </View>
              )
            ) : (
              <Text style={{ fontSize: 18 }}>{result.answer ?? "—"}</Text>
            )}
          </View>

          {result.notes ? <Text style={{ marginTop: 8, color: "#555" }}>Notes: {result.notes}</Text> : null}
        </View>
      )}

      <View style={{ marginTop: 14 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ fontWeight: "700" }}>Raw response (debug)</Text>
          <TouchableOpacity onPress={() => setShowRaw((v) => !v)}>
            <Text style={{ color: "#0b79f7", fontWeight: "700" }}>{showRaw ? "Hide" : "Show Raw Response (Debug)"}</Text>
          </TouchableOpacity>
        </View>

        {!showRaw ? (
          <View style={{ backgroundColor: "#fff", padding: 10, borderRadius: 6, borderWidth: 1, borderColor: "#eee", marginTop: 8 }}>
            <Text style={{ color: "#444" }}>{rawPreview()}</Text>
          </View>
        ) : (
          <View style={{ backgroundColor: "#f6f6f6", padding: 12, marginTop: 8, borderRadius: 6 }}>
            <Text selectable style={{ fontFamily: "monospace", fontSize: 12 }}>
              {JSON.stringify(resultRaw ?? { parsed: null, raw: null }, null, 2)}
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: "bold", marginBottom: 10 },
  input: { borderWidth: 1, padding: 8, marginBottom: 12, borderRadius: 6, borderColor: "#aaa" },
});
