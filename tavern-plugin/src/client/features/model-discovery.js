		// 「设置 → 模型」的 DeepSeek 卡片：按已保存的 API 地址拉取模型列表，勾选后并入模型目录。
		const DEEPSEEK_SETTINGS_NS = "llm-deepseek";

		function DeepSeekModelFetcher(props) {
			const remote = props.remote;
			const [busy, setBusy] = React.useState(false), [notice, setNotice] = React.useState(""), [found, setFound] = React.useState(null), [picked, setPicked] = React.useState({}), [query, setQuery] = React.useState("");
			const existing = React.useRef({ ids: [], models: [], revision: undefined });
			function failure(response) { return String((response && response.error && response.error.message) || "请求失败"); }
			async function fetchModels() {
				setBusy(true); setNotice(""); setFound(null);
				try {
					const described = await remote.settings.describe();
					if (!described.ok) { setNotice(failure(described)); return; }
					const section = described.value.namespaces.find(function (item) { return item.ns === DEEPSEEK_SETTINGS_NS; });
					if (!section) { setNotice("没有找到 DeepSeek 设置"); return; }
					const user = section.user && typeof section.user === "object" ? section.user : {}, effective = section.value && typeof section.value === "object" ? section.value : {};
					const baseURL = typeof user.baseURL === "string" ? user.baseURL : typeof effective.baseURL === "string" ? effective.baseURL : "";
					const models = Array.isArray(user.models) ? user.models : Array.isArray(effective.models) ? effective.models : [];
					existing.current = { ids: models.map(function (model) { return model.id; }), models: models, revision: section.revision };
					const answer = await remote.llm.discoverModels(DEEPSEEK_SETTINGS_NS, baseURL ? { baseURL: baseURL } : {});
					if (!answer.ok) { setNotice(failure(answer)); return; }
					if (!answer.value.length) { setNotice("服务没有返回任何模型，可手动添加。"); return; }
					const known = new Set(existing.current.ids), next = {};
					for (const model of answer.value) if (!known.has(model.id)) next[model.id] = true;
					setFound(answer.value); setPicked(next);
					setNotice("已从 " + (baseURL || "官方地址") + " 获取 " + answer.value.length + " 个模型" + (Object.keys(next).length ? "。" : "，都已在目录中。"));
				} catch (error) { setNotice(String(error && error.message || error)); } finally { setBusy(false); }
			}
			async function addPicked() {
				const chosen = (found || []).filter(function (model) { return picked[model.id]; });
				if (!chosen.length) return;
				setBusy(true);
				try {
					const added = chosen.map(function (model) { const entry = { id: model.id }; if (model.name && model.name !== model.id) entry.name = model.name; if (model.contextWindow) entry.contextWindow = model.contextWindow; if (model.maxTokens) entry.maxTokens = model.maxTokens; return entry; });
					const response = await remote.settings.mutate(DEEPSEEK_SETTINGS_NS, [{ op: "set", path: ["models"], value: existing.current.models.concat(added) }], existing.current.revision);
					if (!response.ok) { setNotice(response.error && response.error.code === "settings/conflict" ? "设置刚被修改过，请重新获取模型列表。" : failure(response)); return; }
					setFound(null); setNotice("已添加 " + added.length + " 个模型，模型目录已更新。");
				} catch (error) { setNotice(String(error && error.message || error)); } finally { setBusy(false); }
			}
			const needle = query.trim().toLowerCase();
			const visible = (found || []).filter(function (model) { return !needle || (model.id + " " + (model.name || "")).toLowerCase().includes(needle); });
			const known = new Set(existing.current.ids);
			return React.createElement("div", { className: "dsh-tavern-model-fetch", style: { display: "grid", gap: 8, marginTop: 12 } },
				React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } },
					React.createElement("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: fetchModels }, busy ? "获取中…" : "获取模型列表"),
					React.createElement("span", { style: { opacity: 0.7, fontSize: 12 } }, "使用已保存的 API 地址和密钥；改过地址请先保存。")),
				notice ? React.createElement("p", { role: "status", style: { margin: 0, fontSize: 13 } }, notice) : null,
				found && found.length ? React.createElement("div", { style: { display: "grid", gap: 6 } },
					React.createElement("input", { type: "search", "aria-label": "搜索模型", placeholder: "搜索模型", value: query, onChange: function (e) { setQuery(e.target.value); } }),
					React.createElement("div", { style: { display: "flex", gap: 8 } },
						React.createElement("button", { type: "button", className: "dsh-tavern-btn", onClick: function () { const next = Object.assign({}, picked); for (const model of visible) if (!known.has(model.id)) next[model.id] = true; setPicked(next); } }, "全选"),
						React.createElement("button", { type: "button", className: "dsh-tavern-btn", onClick: function () { setPicked({}); } }, "全不选")),
					React.createElement("div", { style: { maxHeight: 220, overflow: "auto", display: "grid", gap: 4 } }, visible.map(function (model) {
						const present = known.has(model.id);
						return React.createElement("label", { key: model.id, style: { display: "flex", gap: 8, alignItems: "center", opacity: present ? 0.5 : 1 } },
							React.createElement("input", { type: "checkbox", disabled: present, checked: present || !!picked[model.id], onChange: function (e) { const checked = e.target.checked; setPicked(function (current) { return Object.assign({}, current, { [model.id]: checked }); }); } }),
							React.createElement("span", null, model.id + (present ? "（已在目录）" : "")));
					})),
					React.createElement("div", { style: { display: "flex", gap: 8 } },
						React.createElement("button", { type: "button", className: "dsh-tavern-btn", disabled: busy || !Object.values(picked).some(Boolean), onClick: addPicked }, "添加所选"),
						React.createElement("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: function () { setFound(null); } }, "关闭"))) : null);
		}

		const modelDiscoveryFeature = {
			register: function (input) {
				const ctx = input.ctx, slots = input.slots;
				ctx.effect(function () {
					return slots.inject("settings.models.provider-card", function () { return slots.register({ name: "settings.models.provider-card", key: DEEPSEEK_SETTINGS_NS }, function () { return React.createElement(DeepSeekModelFetcher, { remote: ctx.remote }); }); });
				}, "dsh-tavern: deepseek model fetch");
			}
		};
