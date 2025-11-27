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
  Alert,
  TouchableOpacity,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { WebView } from "react-native-webview";

type LLMResult = {
  latex?: string | null;
  answer?: string | number | null;
  steps?: string[] | null;
  notes?: string | null;
};

declare global {
  interface Window {
    MathJax?: any;
  }
}

export default function IndexScreen() {
  const [image, setImage] = useState<any>(null);
  const [resultRaw, setResultRaw] = useState<any>(null);
  const [result, setResult] = useState<LLMResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [backendUrl, setBackendUrl] = useState("http://localhost:8000");
  const [showRaw, setShowRaw] = useState(false);

  // ref for math container used on web
  const mathRef = useRef<HTMLDivElement | null>(null);

  // load MathJax on web once
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (window.MathJax) return;
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js";
    script.async = true;
    document.head.appendChild(script);
  }, []);

  // whenever result.latex changes on web, typeset it
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (!result?.latex) return;
    setTimeout(async () => {
      try {
        if (window.MathJax && window.MathJax.typesetPromise) {
          if (mathRef.current) {
            await window.MathJax.typesetPromise([mathRef.current]);
          } else {
            await window.MathJax.typesetPromise();
          }
        }
      } catch {
        // ignore
      }
    }, 100);
  }, [result?.latex]);

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      alert("Permission required to access gallery.");
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

  const extractJsonFromText = (txt: string | null): any | null => {
    if (!txt || typeof txt !== "string") return null;
    const fence = /```(?:json)?\n?([\s\S]*?)```/i;
    const m = txt.match(fence);
    if (m && m[1]) {
      const candidate = m[1].trim();
      try {
        return JSON.parse(candidate);
      } catch {
        const s = candidate.indexOf("{");
        const e = candidate.lastIndexOf("}");
        if (s !== -1 && e !== -1 && e > s) {
          try {
            return JSON.parse(candidate.substring(s, e + 1));
          } catch {}
        }
      }
    }
    const s = txt.indexOf("{");
    const e = txt.lastIndexOf("}");
    if (s !== -1 && e !== -1 && e > s) {
      const cand = txt.substring(s, e + 1);
      try {
        return JSON.parse(cand);
      } catch {
        const cleaned = cand.replace(/\n+/g, " ").replace(/\\n/g, "");
        try {
          return JSON.parse(cleaned);
        } catch {}
      }
    }
    return null;
  };

  const sanitizeAnswerString = (a: string): string => {
    if (!a || typeof a !== "string") return a;
    let s = a.replace(/\u2212/g, "-");
    s = s.replace(/-+/g, "-");
    s = s.trim().replace(/^["'`]+|["'`]+$/g, "");
    return s;
  };

  const normalizeParsed = (parsedIn: any, rawText?: string): LLMResult | null => {
    let parsed = parsedIn;
    if (!parsed && !rawText) return null;

    if (typeof parsed === "string") {
      const maybe = extractJsonFromText(parsed);
      if (maybe) parsed = maybe;
      else {
        try {
          parsed = JSON.parse(parsed);
        } catch {}
      }
    }

    try {
      if (parsed && typeof parsed === "object") {
        const c0 = parsed.choices && Array.isArray(parsed.choices) && parsed.choices[0];
        const candidateMsg =
          c0?.message?.content ?? c0?.message ?? c0?.text ?? parsed.message?.content ?? null;
        if (typeof candidateMsg === "string") {
          const extracted = extractJsonFromText(candidateMsg);
          if (extracted && typeof extracted === "object") parsed = extracted;
        }
      }
    } catch {}

    if ((!parsed || typeof parsed !== "object") && rawText) {
      const maybe = extractJsonFromText(rawText);
      if (maybe) parsed = maybe;
    }

    if (!parsed || typeof parsed !== "object") {
      return { latex: null, answer: null, steps: null, notes: rawText ?? String(parsed) };
    }

    const latex =
      parsed.latex ??
      parsed.Latex ??
      parsed.expression ??
      parsed.problem ??
      parsed.question ??
      parsed.math ??
      parsed.formula ??
      null;

    let answer =
      parsed.answer ??
      parsed.Answer ??
      parsed.solution ??
      parsed.result ??
      parsed.final ??
      parsed.answer_text ??
      parsed.answerText ??
      null;

    if (answer != null && typeof answer === "object") {
      if (answer.value != null) answer = answer.value;
      else if (answer.text != null) answer = answer.text;
      else answer = JSON.stringify(answer);
    }

    if (typeof answer === "string") {
      answer = sanitizeAnswerString(answer);
      const asNum = Number(answer);
      if (!Number.isNaN(asNum)) answer = asNum;
    }

    let stepsRaw =
      parsed.steps ??
      parsed.Steps ??
      parsed["step-by-step"] ??
      parsed.explanation ??
      parsed.explanations ??
      parsed.instructions ??
      parsed.solution_steps ??
      parsed.details ??
      null;

    try {
      if (!stepsRaw && parsed.choices && Array.isArray(parsed.choices) && parsed.choices.length > 0) {
        const c = parsed.choices[0];
        const msg = c?.message?.content ?? c?.message ?? c?.text ?? c;
        if (typeof msg === "string") {
          const maybeJson = extractJsonFromText(msg);
          if (!maybeJson) stepsRaw = msg;
        }
      } else if (!stepsRaw && parsed.message && parsed.message.content) {
        stepsRaw = parsed.message.content;
      }
    } catch {}

    if (!stepsRaw && parsed.raw) stepsRaw = parsed.raw;
    if (!stepsRaw && parsed.raw_text) stepsRaw = parsed.raw_text;

    let steps: string[] | null = null;
    if (Array.isArray(stepsRaw)) {
      steps = stepsRaw.map((x) => (typeof x === "string" ? x : JSON.stringify(x)));
    } else if (typeof stepsRaw === "string") {
      let t = stepsRaw.trim();
      t = t.replace(/^```(?:json)?\n?|```$/g, "");
      const lines = t
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length <= 1) {
        const byNumber = t.split(/(?:\n|(?:\d+\.\s)|(?:\d+\)\s))/).map((s) => s.trim()).filter(Boolean);
        if (byNumber.length > 1) steps = byNumber;
        else {
          const sentences = t.split(/(?<=\.)\s+/).map((s) => s.trim()).filter(Boolean);
          steps = sentences.length > 1 ? sentences : [t];
        }
      } else {
        steps = lines;
      }
    }

    const notes = parsed.notes ?? parsed.note ?? parsed.comments ?? null;

    return { latex: latex ?? null, answer: answer ?? null, steps, notes: notes ?? null };
  };

  const send = async (path: string) => {
    if (!image) return alert("Pick an image first");
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
        const response = await fetch(uri);
        const blob = await response.blob();
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

      const res = await fetch(backendUrl + path, { method: "POST", body: form, timeout: 120000 } as any);
      let parsedBody: any = null;
      let rawText: string | null = null;

      try {
        parsedBody = await res.json();
      } catch {
        rawText = await res.text();
      }

      let backendParsed = null;
      let backendRaw = null;
      if (parsedBody && typeof parsedBody === "object" && ("parsed" in parsedBody || "raw" in parsedBody)) {
        backendParsed = parsedBody.parsed ?? null;
        backendRaw = parsedBody.raw ?? null;
      } else if (parsedBody && typeof parsedBody === "object") {
        backendParsed = parsedBody;
      } else if (rawText) {
        backendRaw = rawText;
      }

      try {
        if (backendParsed && typeof backendParsed === "object") {
          const c0 = backendParsed.choices && Array.isArray(backendParsed.choices) && backendParsed.choices[0];
          const candidateMsg =
            c0?.message?.content ?? c0?.message ?? c0?.text ?? backendParsed.message?.content ?? null;
          if (typeof candidateMsg === "string") {
            const extracted = extractJsonFromText(candidateMsg);
            if (extracted && typeof extracted === "object") backendParsed = extracted;
          }
        }
      } catch {}

      if (typeof backendParsed === "string") {
        const ext = extractJsonFromText(backendParsed);
        if (ext) backendParsed = ext;
      }

      if ((!backendParsed || typeof backendParsed !== "object") && backendRaw) {
        const ext = extractJsonFromText(backendRaw);
        if (ext) backendParsed = ext;
      }

      const normalized = normalizeParsed(backendParsed, backendRaw);
      setResultRaw({ parsed: backendParsed, raw: backendRaw ?? rawText });
      setResult(normalized);
    } catch (e: any) {
      Alert.alert("Upload failed", e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  const renderLaTeXOnWeb = (latex: string | null) => {
    const display = latex ? `\\[ ${latex} \\]` : "";
    return (
      <div
        ref={(el) => {
          // @ts-ignore
          mathRef.current = el;
        }}
        style={{ minHeight: 90, marginBottom: 12, fontSize: 20, textAlign: "center" }}
        // insert the raw LaTeX delimiters; MathJax will convert them
        dangerouslySetInnerHTML={{ __html: display }}
      />
    );
  };

  const buildMathJaxHtml = (latex: string) => {
    const safe = (latex || "").replace(/\\(?!\\)/g, "\\\\");
    return `
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8"/>
        <script>
          window.MathJax = {
            tex: {inlineMath: [['$','$'], ['\\\\(','\\\\)']]},
            svg: {fontCache: 'global'}
          };
        </script>
        <script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"></script>
        <style>body{font-family: Arial, sans-serif; padding:12px; color:#111; font-size:20px}</style>
      </head>
      <body>
        <div id="math">\\[ ${safe} \\]</div>
      </body>
      </html>
    `;
  };

  // helper preview string for collapsed raw box
  const rawPreview = () => {
    if (!result) return "No result yet";
    if (result.answer != null) return `Answer: ${result.answer}`;
    if (result.latex) return `LaTeX: ${result.latex.slice(0, 80)}${result.latex.length > 80 ? "…" : ""}`;
    if (result.steps && result.steps.length) return `Steps: ${result.steps[0].slice(0, 80)}${result.steps[0].length > 80 ? "…" : ""}`;
    return "No parsed preview";
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 20 }}>
      <Text style={styles.title}>LLM Math Solver — Pretty View</Text>

      <Text style={{ marginBottom: 6 }}>Backend URL:</Text>
      <TextInput value={backendUrl} onChangeText={setBackendUrl} style={styles.input} />

      <Button title="Pick an Image From PC" onPress={pickImage} />

      {image && (
        <Image source={{ uri: image.uri }} style={{ width: "100%", height: 240, marginTop: 12, borderRadius: 10 }} resizeMode="contain" />
      )}

      <View style={{ marginTop: 12 }}>
        <Button title="Solve with Gemini" onPress={() => send("/solve-gemini")} disabled={loading} />
      </View>
      <View style={{ marginTop: 8 }}>
        <Button title="Solve with Perplexity" onPress={() => send("/solve-perplexity")} disabled={loading} />
      </View>

      {loading && <ActivityIndicator size="large" style={{ marginTop: 20 }} />}

      {result && (
        <View style={{ marginTop: 18, backgroundColor: "#fff", padding: 16, borderRadius: 8 }}>
          <Text style={{ color: "#666", marginBottom: 6 }}>Expression</Text>

          {result.latex ? (
            Platform.OS === "web" ? (
              // on web render LaTeX inside a div and let MathJax typeset it
              // @ts-ignore
              renderLaTeXOnWeb(result.latex)
            ) : (
              // on native use WebView (full HTML)
              <View style={{ height: 90, marginBottom: 12 }}>
                <WebView originWhitelist={["*"]} source={{ html: buildMathJaxHtml(result.latex) }} style={{ flex: 1 }} javaScriptEnabled domStorageEnabled />
              </View>
            )
          ) : (
            <Text style={{ color: "#444", marginBottom: 8 }}>{result.notes ?? "Expression"}</Text>
          )}

          <Text style={{ fontWeight: "700", marginBottom: 6 }}>Let's solve it step-by-step:</Text>
          {result.steps && result.steps.length ? (
            <View style={{ marginBottom: 12 }}>
              {result.steps.map((s, i) => (
                <View key={i} style={{ marginBottom: 8 }}>
                  <Text style={{ fontWeight: "600" }}>{i + 1}. {s}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6 }}>
            <Text style={{ fontSize: 18, fontWeight: "700", marginRight: 10 }}>✅ Final Answer:</Text>
            <Text style={{ fontSize: 18, fontWeight: "700" }}>{result.answer ?? "—"}</Text>
          </View>

          {result.notes ? <Text style={{ marginTop: 10, color: "#555" }}>Notes: {result.notes}</Text> : null}
        </View>
      )}

      <View style={{ marginTop: 14 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <Text style={{ fontWeight: "700" }}>Raw response (debug)</Text>
          <TouchableOpacity onPress={() => setShowRaw((v) => !v)} style={{ padding: 6 }}>
            <Text style={{ color: "#0b79f7", fontWeight: "700" }}>{showRaw ? "Hide" : "Show Raw Response (Debug)"}</Text>
          </TouchableOpacity>
        </View>

        {/* preview when collapsed */}
        {!showRaw && (
          <View style={{ backgroundColor: "#fff", padding: 10, borderRadius: 6, borderWidth: 1, borderColor: "#eee" }}>
            <Text style={{ color: "#444" }}>{rawPreview()}</Text>
          </View>
        )}

        {/* expanded raw debug */}
        {showRaw && (
          <View style={{ backgroundColor: "#f6f6f6", padding: 12, borderRadius: 6, maxHeight: 360 }}>
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
