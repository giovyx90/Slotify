// SPDX-License-Identifier: GPL-3.0-or-later
import { mount } from "svelte";
import "./ui/theme.css";
import App from "./ui/App.svelte";

mount(App, { target: document.getElementById("app")! });
