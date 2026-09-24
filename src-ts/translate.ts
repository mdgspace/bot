// Description:
//   Allows Hubot to know many languages.
//
// Commands:
//   hubot translate me <phrase> - Searches for a translation for the <phrase> and then prints that bad boy out.
//   hubot translate me from <source> into <target> <phrase> - Translates <phrase> from <source> into <target>. Both <source> and <target> are optional

import type { Robot } from "./runtime/types";

const API_KEY = process.env.HUBOT_GOOGLE_TRANSLATE_API_KEY;

const languages: { [code: string]: string } = {
  af: "Afrikaans",
  sq: "Albanian",
  ar: "Arabic",
  az: "Azerbaijani",
  eu: "Basque",
  bn: "Bengali",
  be: "Belarusian",
  bg: "Bulgarian",
  ca: "Catalan",
  "zh-CN": "Simplified Chinese",
  "zh-TW": "Traditional Chinese",
  hr: "Croatian",
  cs: "Czech",
  da: "Danish",
  nl: "Dutch",
  en: "English",
  eo: "Esperanto",
  et: "Estonian",
  tl: "Filipino",
  fi: "Finnish",
  fr: "French",
  gl: "Galician",
  ka: "Georgian",
  de: "German",
  el: "Greek",
  gu: "Gujarati",
  ht: "Haitian Creole",
  iw: "Hebrew",
  hi: "Hindi",
  hu: "Hungarian",
  is: "Icelandic",
  id: "Indonesian",
  ga: "Irish",
  it: "Italian",
  ja: "Japanese",
  kn: "Kannada",
  ko: "Korean",
  la: "Latin",
  lv: "Latvian",
  lt: "Lithuanian",
  mk: "Macedonian",
  ms: "Malay",
  mt: "Maltese",
  no: "Norwegian",
  fa: "Persian",
  pl: "Polish",
  pt: "Portuguese",
  ro: "Romanian",
  ru: "Russian",
  sr: "Serbian",
  sk: "Slovak",
  sl: "Slovenian",
  es: "Spanish",
  sw: "Swahili",
  sv: "Swedish",
  ta: "Tamil",
  te: "Telugu",
  th: "Thai",
  tr: "Turkish",
  uk: "Ukrainian",
  ur: "Urdu",
  vi: "Vietnamese",
  cy: "Welsh",
  yi: "Yiddish",
};

function getCode(
  language: string,
  langs: { [code: string]: string },
): string | undefined {
  for (const code of Object.keys(langs)) {
    if (langs[code].toLowerCase() === language.toLowerCase()) {
      return code;
    }
  }
  return undefined;
}

export = (robot: Robot): void => {
  const languageChoices = Object.values(languages).sort().join("|");
  const pattern = new RegExp(
    "translate(?: me)?" +
      `(?: from (${languageChoices}))?` +
      `(?: (?:in)?to (${languageChoices}))?` +
      "(.*)",
    "i",
  );

  robot.respond(pattern, (msg) => {
    if (!API_KEY) {
      msg.send(
        "Please set the HUBOT_GOOGLE_TRANSLATE_API_KEY environment variable.",
      );
      return;
    }
    const term = `"${msg.match[3]?.trim()}"`;
    const origin =
      msg.match[1] !== undefined
        ? (getCode(msg.match[1], languages) ?? "auto")
        : "auto";
    const target =
      msg.match[2] !== undefined
        ? (getCode(msg.match[2], languages) ?? "en")
        : "en";

    msg
      .http("https://www.googleapis.com/language/translate/v2")
      .query({
        key: API_KEY,
        // Omitting source asks Google to detect it; "auto" is not a language code.
        ...(origin === "auto" ? {} : { source: origin }),
        target: target,
        q: term,
      })
      .get()((err, res, body) => {
      if (err || !res || body == null) {
        msg.send("Failed to connect to GAPI");
        robot.emit("error", err || new Error("Empty Google Translate response"), res);
        return;
      }

      if (res.statusCode !== 200) {
        let reason = "";
        try {
          const error = JSON.parse(body).error?.message;
          if (typeof error === "string") reason = error;
        } catch { /* Keep the HTTP status when Google does not return JSON. */ }
        if (res.statusCode === 403 && /(?:User Rate Limit Exceeded|Daily Limit Exceeded)/i.test(reason)) {
          msg.send("Google Translate quota exceeded; check the project's Cloud Translation quotas.");
        } else {
          msg.send(`Google Translate request failed (HTTP ${res.statusCode}).`);
        }
        robot.emit("error", new Error(`Google Translate HTTP ${res.statusCode}`));
        return;
      }

      try {
        const parsed = JSON.parse(body).data?.translations?.[0];
        if (typeof parsed?.translatedText !== "string") {
          msg.send("Google Translate returned an unexpected response.");
          return;
        }
        const source = parsed.detectedSourceLanguage || origin;
        const language = languages[source] || source;
        const translated = parsed.translatedText;
        if (msg.match[2] === undefined) {
          msg.send(`${term} is ${language} for ${translated}`);
        } else {
          msg.send(
            `The ${language} ${term} translates as ${translated} in ${languages[target]}`,
          );
        }
      } catch (err2) {
        msg.send("Failed to parse GAPI response");
        robot.emit("error", err2);
      }
    });
  });
};
