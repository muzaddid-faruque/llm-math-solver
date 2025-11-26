import React, { useState } from "react";
import {
  View,
  Button,
  Image,
  Text,
  ActivityIndicator,
  ScrollView,
  TextInput,
  Platform,
} from "react-native";
import * as ImagePicker from "expo-image-picker";

export default function IndexScreen() {
  const [image, setImage] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // ✔ DEFAULT: localhost for PC testing
  const [backendUrl, setBackendUrl] = useState("http://localhost:8000");

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      alert("Permission required to access gallery.");
      return;
    }

    const res: any = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });

    if (!res.canceled) {
      setImage(res.assets[0]);
      setResult(null);
    }
  };

  const send = async (path: string) => {
    if (!image) return alert("Pick an image first");

    setLoading(true);
    try {
      const uri = image.uri;
      const filename = uri.split("/").pop();
      const match = /\.(\w+)$/.exec(filename);
      const type = match ? `image/${match[1]}` : "image/jpeg";

      const form = new FormData();
      form.append(
        "file",
        {
          uri: Platform.OS === "android" ? uri : uri.replace("file://", ""),
          name: filename,
          type,
        } as any
      );

      const response = await fetch(backendUrl + path, {
        method: "POST",
        body: form,
      });

      const json = await response.json();
      setResult(json);
    } catch (err: any) {
      alert("Error: " + err.message);
    }
    setLoading(false);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 20 }}>
      <Text style={{ fontSize: 22, fontWeight: "bold", marginBottom: 10 }}>
        LLM Math Solver (Localhost Test)
      </Text>

      <Text style={{ marginBottom: 6 }}>Backend URL:</Text>
      <TextInput
        value={backendUrl}
        onChangeText={setBackendUrl}
        style={{
          borderWidth: 1,
          padding: 8,
          marginBottom: 12,
          borderRadius: 6,
          borderColor: "#aaa",
        }}
      />

      <Button title="Pick an Image From PC" onPress={pickImage} />

      {image && (
        <Image
          source={{ uri: image.uri }}
          style={{
            width: "100%",
            height: 300,
            marginTop: 15,
            borderRadius: 10,
          }}
        />
      )}

      <View style={{ marginTop: 15 }}>
        <Button title="Solve with Gemini" onPress={() => send("/solve-gemini")} />
      </View>

      <View style={{ marginTop: 10 }}>
        <Button
          title="Solve with Perplexity"
          onPress={() => send("/solve-perplexity")}
        />
      </View>

      {loading && <ActivityIndicator size="large" style={{ marginTop: 20 }} />}

      {result && (
        <View style={{ marginTop: 15 }}>
          <Text style={{ fontWeight: "bold", marginBottom: 6 }}>Response:</Text>
          <Text selectable style={{ fontFamily: "monospace" }}>
            {JSON.stringify(result, null, 2)}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}
