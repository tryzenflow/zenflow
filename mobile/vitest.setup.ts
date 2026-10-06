import { beforeEach } from "vitest";
import { setLanguage } from "./lib/i18n";

// The app defaults to Vietnamese; most specs assert the English source strings.
beforeEach(() => setLanguage("en"));
