// SPDX-License-Identifier: GPL-3.0-or-later
import { mount } from "svelte";
import "./ui/theme.css";
import App from "./ui/App.svelte";
import { applySettings } from "./ui/settings.svelte";

// Before the first paint, or the window flashes the wrong theme on the way in.
applySettings();

mount(App, { target: document.getElementById("app")! });
