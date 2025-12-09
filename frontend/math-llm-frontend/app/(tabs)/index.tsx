import React, { useState, useEffect } from "react";
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
import katex from "katex";

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

type UploadStage = "idle" | "uploading" | "processing" | "complete" | "error";

export default function IndexScreen() {
  const [image, setImage] = useState<ImageAsset | null>(null);
  const [resultRaw, setResultRaw] = useState<BackendResponse | null>(null);
  const [result, setResult] = useState<LLMResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploadStage, setUploadStage] = useState<UploadStage>("idle");
  const [backendUrl, setBackendUrl] = useState("http://localhost:8000");
  const [showRaw, setShowRaw] = useState(false);

  // Load KaTeX CSS on web
  useEffect(() => {
    if (Platform.OS !== "web") return;

    // Check if KaTeX CSS is already loaded
    if (document.querySelector('link[href*="katex"]')) return;

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css";
    link.crossOrigin = "anonymous";
    link.onload = () => {
      console.log("KaTeX CSS loaded successfully");
    };
    document.head.appendChild(link);
  }, []);

  // ---- helpers ----
  const extractJsonFromText = (text?: string | null): any | null => {
    if (!text || typeof text !== "string") return null;
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first !== -1 && last !== -1 && last > first) {
      const candidate = text.slice(first, last + 1);
      try {
        return JSON.parse(candidate);
      } catch { }
      const cleaned = candidate.replace(/\\n/g, " ").replace(/\r/g, " ");
      try {
        return JSON.parse(cleaned);
      } catch { }
    }
    const fence = /```(?:json)?\n?([\s\S]*?)```/i.exec(text);
    if (fence && fence[1]) {
      const inner = fence[1].trim();
      try {
        return JSON.parse(inner);
      } catch { }
    }
    return null;
  };

  const cleanLatex = (s?: string | null): string | null => {
    if (!s || typeof s !== "string") return null;
    let t = s.trim();

    // Remove code fences
    t = t.replace(/```(?:json)?\n?/gi, "").replace(/```$/gi, "");

    // Remove wrapping quotes
    t = t.replace(/^["'`]+|["'`]+$/g, "");

    // Replace literal \n and \r with spaces
    t = t.replace(/\\n/g, " ").replace(/\r/g, " ");

    // DON'T collapse backslashes - keep them for LaTeX commands!
    // t = t.replace(/\\\\+/g, "\\");  // REMOVED - this was breaking LaTeX

    // Remove boxed wrapper
    t = t.replace(/\\boxed\{([^}]+)\}/g, "$1");

    t = t.trim();

    return t;
  };

  const looksLikeLatex = (s?: string | null) => {
    if (!s || typeof s !== "string") return false;
    return /\\frac|\\sqrt|\\times|\\div|\\left|\\right|\\\(|\\\[|\\\]|\\sqrt|\\cdot|\\pi|{\\|\\\\/.test(
      s
    );
  };

  const normalizeParsed = (parsedIn: any, rawText?: string | null): LLMResult => {
    let parsed = parsedIn ?? null;

    if (typeof parsed === "string") {
      const maybe = extractJsonFromText(parsed);
      if (maybe) parsed = maybe;
      else {
        try {
          parsed = JSON.parse(parsed);
        } catch { }
      }
    }

    if ((!parsed || typeof parsed !== "object") && rawText) {
      const maybe = extractJsonFromText(rawText);
      if (maybe) parsed = maybe;
    }

    const latex = parsed?.latex ?? parsed?.Latex ?? parsed?.expression ?? null;
    let answer =
      parsed?.answer ?? parsed?.Answer ?? parsed?.result ?? parsed?.final ?? null;
    let steps =
      parsed?.steps ??
      parsed?.Steps ??
      parsed?.explanation ??
      parsed?.details ??
      null;
    const notes = parsed?.notes ?? parsed?.note ?? null;

    if (
      (!latex && !answer && !steps) &&
      parsed?.choices &&
      Array.isArray(parsed.choices) &&
      parsed.choices.length
    ) {
      const msg =
        parsed.choices[0]?.message?.content ??
        parsed.choices[0]?.message ??
        parsed.choices[0]?.text;
      if (typeof msg === "string") {
        const inner = extractJsonFromText(msg);
        if (inner) {
          return normalizeParsed(inner, rawText);
        } else {
          steps = steps ?? msg;
        }
      }
    }

    let stepsArr: string[] | null = null;
    if (Array.isArray(steps)) {
      stepsArr = steps.map((s) =>
        typeof s === "string" ? s : JSON.stringify(s)
      );
    } else if (typeof steps === "string") {
      const cleaned = steps.trim();
      const fenced = cleaned
        .replace(/^```(?:json)?/i, "")
        .replace(/```$/i, "");
      const lines = fenced
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length > 1) stepsArr = lines;
      else {
        const byNumber = cleaned
          .split(/\d+\.\s+/)
          .map((p) => p.trim())
          .filter(Boolean);
        if (byNumber.length > 1) stepsArr = byNumber;
        else {
          const sentences = cleaned
            .split(/(?<=\.)\s+/)
            .map((s) => s.trim())
            .filter(Boolean);
          stepsArr = sentences.length > 1 ? sentences : [cleaned];
        }
      }
    }

    const cleanedLatex = cleanLatex(typeof latex === "string" ? latex : null);
    if (typeof answer === "string") answer = cleanLatex(answer) ?? answer;
    if (Array.isArray(stepsArr))
      stepsArr = stepsArr.map((s) =>
        typeof s === "string" ? cleanLatex(s) ?? s : String(s)
      );

    return {
      latex: cleanedLatex,
      answer,
      steps: stepsArr,
      notes,
    };
  };

  const copyToClipboard = async (text: string, label: string = "Text") => {
    try {
      if (Platform.OS === "web") {
        await navigator.clipboard.writeText(text);
      } else {
        Clipboard.setString(text);
      }
      Alert.alert("Copied", `${label} copied to clipboard!`);
    } catch {
      Alert.alert("Error", "Failed to copy to clipboard");
    }
  };

  // (uploadStage currently unused but can be used later)
  const getStatusMessage = (): string => {
    switch (uploadStage) {
      case "uploading":
        return "Uploading image...";
      case "processing":
        return "AI is solving the problem...";
      case "complete":
        return "Complete!";
      case "error":
        return "An error occurred";
      default:
        return "";
    }
  };

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

      const resp = await fetch(backendUrl + path, {
        method: "POST",
        body: form,
      } as any);
      let parsedJson = null;
      let rawText = null;
      try {
        parsedJson = await resp.json();
      } catch {
        rawText = await resp.text();
      }

      let backendParsed = null;
      let backendRaw = null;
      if (parsedJson && typeof parsedJson === "object") {
        backendParsed = parsedJson.parsed ?? parsedJson;
        backendRaw = parsedJson.raw ?? null;
      } else if (rawText) {
        backendRaw = rawText;
      }

      if (typeof backendParsed === "object") {
        if (
          backendParsed.choices &&
          Array.isArray(backendParsed.choices) &&
          backendParsed.choices.length
        ) {
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

  // ==== KaTeX rendering helpers ====

  // Build KaTeX HTML for WebView (native)
  const buildKaTeXHtml = (latex?: string | null, displayMode: boolean = true) => {
    if (!latex) return "";

    try {
      const renderedHTML = katex.renderToString(latex, {
        displayMode: displayMode,
        throwOnError: false,
        output: 'html',
        strict: false,
      });

      return `<!doctype html><html><head><meta charset="utf-8"/>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
        <style>
          body{
            font-family:Arial;
            padding:10px;
            margin:0;
            color:#111;
            display:flex;
            align-items:center;
            justify-content:center;
            min-height:50px;
          }
          .katex-display {
            margin: 0;
          }
        </style>
        </head><body>${renderedHTML}</body></html>`;
    } catch (error) {
      console.error("KaTeX rendering error:", error);
      return `<!doctype html><html><body>${latex}</body></html>`;
    }
  };

  // Build HTML for step with mixed text and LaTeX using KaTeX
  const buildStepHtml = (stepNumber: number, content: string) => {
    // Use the same rendering logic as web
    const processedContent = renderMixedContent(content);

    return `<!doctype html><html><head><meta charset="utf-8"/>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
          padding: 8px;
          margin: 0;
          color: #222;
          font-size: 15px;
          line-height: 1.8;
        }
        strong { font-weight: 600; }
      </style>
    </head>
    <body>
      <strong>${stepNumber}.</strong> ${processedContent}
    </body>
    </html>`;
  };

  const rawPreview = () => {
    if (!result) return "No result yet";
    if (result.answer) return `Answer: ${result.answer}`;
    if (result.latex)
      return `Expression: ${String(result.latex).slice(0, 60)}${String(result.latex).length > 60 ? "…" : ""
        }`;
    if (result.steps && result.steps.length)
      return `Step 1: ${result.steps[0].slice(0, 80)}${result.steps[0].length > 80 ? "…" : ""
        }`;
    return "No parsed preview";
  };

  // Web expression renderer using KaTeX
  const renderLatexWeb = (latex?: string | null, style?: any, displayMode: boolean = true) => {
    if (!latex) return null;

    try {
      const html = katex.renderToString(latex, {
        displayMode: displayMode,
        throwOnError: false,
        output: 'html',
        strict: false,
      });

      return (
        <div
          className="katex-container"
          style={{
            ...style,
            minHeight: displayMode ? '60px' : 'auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    } catch (error) {
      console.error("KaTeX rendering error:", error);
      return <Text style={style}>{latex}</Text>;
    }
  };

  // Helper to render mixed text and math content
  const renderMixedContent = (content: string): string => {
    if (!content) return "";

    let processed = content;

    // Clean up encoding issues
    processed = processed.replace(/√/g, '\\sqrt');

    // First handle existing LaTeX delimiters
    processed = processed.replace(/\\\[(.*?)\\\]/gs, (match, latex) => {
      try {
        return katex.renderToString(latex, { displayMode: true, throwOnError: false });
      } catch {
        return match;
      }
    });

    processed = processed.replace(/\\\((.*?)\\\)/g, (match, latex) => {
      try {
        return katex.renderToString(latex, { displayMode: false, throwOnError: false });
      } catch {
        return match;
      }
    });

    // Handle $$ and $ delimiters
    processed = processed.replace(/\$\$(.*?)\$\$/gs, (match, latex) => {
      try {
        return katex.renderToString(latex, { displayMode: true, throwOnError: false });
      } catch {
        return match;
      }
    });

    processed = processed.replace(/\$([^\$]+)\$/g, (match, latex) => {
      try {
        return katex.renderToString(latex, { displayMode: false, throwOnError: false });
      } catch {
        return match;
      }
    });

    // Handle inline LaTeX commands that aren't in delimiters
    // Wrap sequences like \log_b, x^2, etc. while preserving surrounding text
    processed = processed.replace(/(\\[a-zA-Z]+(?:_\{[^}]+\}|_[a-zA-Z0-9])?(?:\^?\{[^}]+\}|\^[a-zA-Z0-9])?|\w+\^?\{[^}]+\}|\w+\^[a-zA-Z0-9])/g, (match) => {
      // Don't re-render if already rendered
      if (match.includes('katex')) return match;

      // Only render if it looks like LaTeX math notation
      if (/\\[a-zA-Z]+|[_^]/.test(match)) {
        try {
          return katex.renderToString(match, { displayMode: false, throwOnError: false });
        } catch {
          return match;
        }
      }
      return match;
    });

    // Don't auto-wrap entire content - text spacing is preserved
    return processed;
  };

  // ==== UI ====
  return (
    <ScrollView contentContainerStyle={{ padding: 18 }}>
      <Text style={styles.title}>LLM Math Solver — Pretty View</Text>

      <Text style={{ marginBottom: 6 }}>Backend URL:</Text>
      <TextInput
        value={backendUrl}
        onChangeText={setBackendUrl}
        style={styles.input}
      />

      <Button title="Pick an Image From PC" onPress={pickImage} />

      {image && (
        <Image
          source={{ uri: image.uri }}
          style={{
            width: "100%",
            height: 220,
            marginTop: 12,
            borderRadius: 8,
          }}
          resizeMode="contain"
        />
      )}

      <View style={{ marginTop: 12 }}>
        <Button
          title="Solve with Gemini"
          onPress={() => send("/solve-gemini")}
          disabled={loading}
        />
      </View>
      <View style={{ marginTop: 8 }}>
        <Button
          title="Solve with Perplexity"
          onPress={() => send("/solve-perplexity")}
          disabled={loading}
        />
      </View>
      <View style={{ marginTop: 8 }}>
        <Button
          title="Solve with ChatGPT"
          onPress={() => send("/solve-chatgpt")}
          disabled={loading}
        />
      </View>

      {loading && (
        <ActivityIndicator size="large" style={{ marginTop: 18 }} />
      )}

      {result && (
        <View
          style={{
            backgroundColor: "#fff",
            padding: 14,
            marginTop: 16,
            borderRadius: 8,
          }}
        >
          <Text style={{ color: "#666", marginBottom: 4 }}>Expression</Text>
          <View
            style={{
              borderWidth: 1,
              borderColor: "#ddd",
              borderRadius: 8,
              paddingVertical: 10,
              paddingHorizontal: 10,
              marginBottom: 10,
              minHeight: 50,
              justifyContent: "center",
            }}
          >
            {result.latex ? (
              Platform.OS === "web" ? (
                renderLatexWeb(result.latex, {
                  textAlign: "center",
                  fontSize: 20,
                  width: "100%",
                }, true) // Use display mode for better rendering
              ) : (
                <View style={{ height: 60, width: "100%" }}>
                  <WebView
                    originWhitelist={["*"]}
                    source={{ html: buildKaTeXHtml(result.latex, true) }}
                    style={{ flex: 1 }}
                  />
                </View>
              )
            ) : (
              <Text style={{ color: "#333" }}>
                {result.notes ?? "Expression"}
              </Text>
            )}
          </View>

          <Text style={{ fontWeight: "700", marginBottom: 8 }}>
            Let's solve it step-by-step:
          </Text>

          {result.steps && result.steps.length ? (
            <View style={{ marginBottom: 12 }}>
              {result.steps.map((s, idx) => {
                const stepText = s ?? "";
                let displayContent = stepText.trim();

                // Clean up weird characters
                displayContent = displayContent.replace(/√/g, '\\sqrt');
                displayContent = displayContent.replace(/�/g, '');

                return (
                  <View
                    key={idx}
                    style={{ marginBottom: 10, paddingLeft: 10 }}
                  >
                    {Platform.OS === "web" ? (
                      <div style={{ textAlign: "left", fontSize: "16px", lineHeight: "1.8" }}>
                        <strong>{idx + 1}. </strong>
                        <span
                          dangerouslySetInnerHTML={{
                            __html: renderMixedContent(displayContent)
                          }}
                        />
                      </div>
                    ) : (
                      <View style={{ minHeight: 60 }}>
                        <WebView
                          originWhitelist={["*"]}
                          source={{
                            html: buildStepHtml(idx + 1, displayContent),
                          }}
                          style={{ flex: 1 }}
                        />
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          ) : null}

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              marginTop: 4,
            }}
          >
            <Text
              style={{
                fontWeight: "700",
                fontSize: 18,
                marginRight: 10,
              }}
            >
              ✅ Final Answer:
            </Text>
            {result.answer ? (
              typeof result.answer === "string" && looksLikeLatex(result.answer) ? (
                Platform.OS === "web" ? (
                  renderLatexWeb(String(result.answer), { fontSize: 20 }, false)
                ) : (
                  <View style={{ height: 56, width: "60%" }}>
                    <WebView
                      originWhitelist={["*"]}
                      source={{ html: buildKaTeXHtml(String(result.answer), false) }}
                      style={{ flex: 1, backgroundColor: 'transparent' }}
                    />
                  </View>
                )
              ) : (
                <Text style={{ fontSize: 20, fontWeight: "600", color: "#000" }}>
                  {String(result.answer)}
                </Text>
              )
            ) : (
              <Text style={{ fontSize: 18, color: "#999" }}>—</Text>
            )}
          </View>

          {result.notes ? (
            <Text style={{ marginTop: 8, color: "#555" }}>
              Notes: {result.notes}
            </Text>
          ) : null}
        </View>
      )}

      <View style={{ marginTop: 14 }}>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Text style={{ fontWeight: "700" }}>Raw response (debug)</Text>
          <TouchableOpacity onPress={() => setShowRaw((v) => !v)}>
            <Text style={{ color: "#0b79f7", fontWeight: "700" }}>
              {showRaw ? "Hide" : "Show Raw Response (Debug)"}
            </Text>
          </TouchableOpacity>
        </View>

        {!showRaw ? (
          <View
            style={{
              backgroundColor: "#fff",
              padding: 10,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: "#eee",
              marginTop: 8,
            }}
          >
            <Text style={{ color: "#444" }}>{rawPreview()}</Text>
          </View>
        ) : (
          <View
            style={{
              backgroundColor: "#f6f6f6",
              padding: 12,
              marginTop: 8,
              borderRadius: 6,
            }}
          >
            <Text
              selectable
              style={{ fontFamily: "monospace", fontSize: 12 }}
            >
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
  input: {
    borderWidth: 1,
    padding: 8,
    marginBottom: 12,
    borderRadius: 6,
    borderColor: "#aaa",
  },
});
