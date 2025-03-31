import { Plugin, PluginSettingTab, App, Setting, Modal, Notice } from "obsidian";
import Sortable from "sortablejs";

interface CssBlock {
  name: string;
  selector: string;
  body: string;
  description?: string;
}

export default class CssEditorPlugin extends Plugin {
  async onload() {
    console.log("✅ CSS Editor Plugin loaded");
    this.addSettingTab(new CssEditorSettingTab(this.app, this));
  }
}

class CssEditorSettingTab extends PluginSettingTab {
  plugin: CssEditorPlugin;
  filePath = `${this.app.vault.configDir}/snippets/css-editor.css`;
  editedBlocks: CssBlock[] = [];
  searchQuery = "";

  constructor(app: App, plugin: CssEditorPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  async display(): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();

    // === Search Bar ===
    const searchInput = containerEl.createEl("input", {
      type: "text",
      placeholder: "Search by name or selector...",
    });
    searchInput.style.marginBottom = "1em";
    searchInput.style.width = "100%";
    searchInput.addEventListener("keydown", async (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        const matchIndex = this.editedBlocks.findIndex((block) => {
          const target = `${block.name} ${block.selector}`.toLowerCase();
          return target.includes(searchInput.value.toLowerCase());
        });

        if (matchIndex >= 0) {
          const matchedEl = containerEl.querySelectorAll(".css-block-section").item(matchIndex);
          if (matchedEl) matchedEl.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
    });

    // === Action Buttons ===
    const actionContainer = containerEl.createDiv();
    actionContainer.style.display = "flex";
    actionContainer.style.gap = "1em";
    actionContainer.style.marginBottom = "1.5em";

    const addButton = actionContainer.createEl("button", { text: "+ Add New Block" });
    addButton.onclick = async () => {
      new AddBlockModal(this.app, async (name, selector, description) => {
        const newBlock: CssBlock = { name, selector, body: `  /* your styles here */`, description };
        this.editedBlocks.push(newBlock);
        await this.saveBlocks();
        await this.display();
      }).open();
    };

    const importBtn = actionContainer.createEl("button", { text: "⬆ Import" });
    importBtn.onclick = async () => {
      try {
        const [handle] = await (window as any).showOpenFilePicker({
          types: [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }],
          excludeAcceptAllOption: true,
          multiple: false
        });
        const file = await handle.getFile();
        const text = await file.text();
        const parsed: CssBlock[] = JSON.parse(text);
        this.editedBlocks = parsed;
        await this.saveBlocks();
        await this.display();
        new Notice("✅ Imported CSS blocks.");
      } catch (e) {
        console.error(e);
        new Notice("❌ Failed to import file.");
      }
    };

    const exportBtn = actionContainer.createEl("button", { text: "⬇ Export" });
    exportBtn.onclick = async () => {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: "css-export.json",
          types: [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(JSON.stringify(this.editedBlocks, null, 2));
        await writable.close();
        new Notice("✅ Exported CSS blocks.");
      } catch (e) {
        console.error(e);
        new Notice("❌ Failed to export file.");
      }
    };

    // === Read and Render CSS Blocks ===
    const adapter = this.app.vault.adapter;
    let fileContent = "";
    try {
      fileContent = await adapter.read(this.filePath);
    } catch (e) {
      await adapter.write(this.filePath, "");
    }

    const blocks = this.parseBlocks(fileContent);
    this.editedBlocks = blocks;

    const container = containerEl.createDiv();
    container.id = "sortable-css-blocks";

    const filteredBlocks = blocks.filter((block) => {
      const target = `${block.name} ${block.selector}`.toLowerCase();
      return target.includes(this.searchQuery.toLowerCase());
    });

    filteredBlocks.forEach((block, index) => {
      const section = container.createDiv({ cls: "css-block-section" });
      section.style.marginBottom = "1.5em";

      const headerRow = section.createDiv({ cls: "css-block-header" });
      headerRow.style.display = "flex";
      headerRow.style.alignItems = "center";

      const heading = headerRow.createEl("h2", { text: block.name });
      heading.style.flex = "1";
      heading.style.margin = "0";

      const editBtn = headerRow.createEl("button", { text: "✎" });
      editBtn.style.marginLeft = "0.5em";
      editBtn.onclick = () => {
        new AddBlockModal(this.app, async (name, selector, description) => {
          this.editedBlocks[index].name = name;
          this.editedBlocks[index].selector = selector;
          this.editedBlocks[index].description = description;
          await this.saveBlocks();
          await this.display();
        }, block).open();
      };

      const removeBtn = headerRow.createEl("button", { text: "×" });
      removeBtn.classList.add("mod-warning");
      removeBtn.style.marginLeft = "0.5em";
      removeBtn.onclick = async () => {
        this.editedBlocks.splice(index, 1);
        await this.saveBlocks();
        await this.display();
      };

      const selectorDisplay = section.createEl("code", { text: block.selector });
      selectorDisplay.style.display = "block";
      selectorDisplay.style.margin = "0.2em 0";

      if (block.description) {
        const desc = section.createEl("p", { text: block.description });
        desc.style.margin = "0.4em 0";
      }

      const textarea = section.createEl("textarea", { cls: "css-editor-input" });
      textarea.style.marginTop = "0.4em";
      textarea.value = block.body.split("\n").map(line => line.trimStart()).join("\n");
      textarea.rows = block.body.split("\n").length + 1;
      textarea.addEventListener("input", async () => {
        this.editedBlocks[index].body = textarea.value.trim();
        await this.saveBlocks();
      });
    });

    // === Sortable Drag & Drop ===
    Sortable.create(container, {
      animation: 150,
      handle: ".css-block-header",
      onEnd: async (evt: Sortable.SortableEvent) => {
        const movedItem = this.editedBlocks.splice(evt.oldIndex!, 1)[0];
        this.editedBlocks.splice(evt.newIndex!, 0, movedItem);
        await this.saveBlocks();
      },
    });
  }

  async saveBlocks() {
    const adapter = this.app.vault.adapter;
    const updatedContent = this.editedBlocks.map((block) => this.buildCssBlock(block)).join("\n\n");
    await adapter.write(this.filePath, updatedContent);
  }

  parseBlocks(content: string): CssBlock[] {
    const regex = /\/\*\s*css-class-start\s+name:\"([^\"]+)\"(?:\s+description:\"([^\"]*)\")?\s*\*\/(.*?)\/\*\s*css-class-end\s*\*\//gs;
    const blocks: CssBlock[] = [];

    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const name = match[1].trim();
      const description = match[2]?.trim();
      const blockContent = match[3].trim();

      const selectorMatch = blockContent.match(/^(.*?)\s*\{/s);
      if (!selectorMatch) continue;

      const selector = selectorMatch[1].trim();
      const body = blockContent.slice(selectorMatch[0].length, blockContent.lastIndexOf("}"))?.trim();

      blocks.push({ name, selector, body, description });
    }

    return blocks;
  }

  buildCssBlock(block: CssBlock): string {
    const desc = block.description ? ` description:\"${block.description}\"` : "";
    return `/* css-class-start name:\"${block.name}\"${desc} */\n${block.selector} {\n${block.body}\n}\n/* css-class-end */`;
  }
}

class AddBlockModal extends Modal {
  onSubmit: (name: string, selector: string, description: string) => void;
  initial?: CssBlock;

  constructor(app: App, onSubmit: (name: string, selector: string, description: string) => void, initial?: CssBlock) {
    super(app);
    this.onSubmit = onSubmit;
    this.initial = initial;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: this.initial ? "Edit CSS Block" : "Add New CSS Block" });

    let name = this.initial?.name || "";
    let selector = this.initial?.selector || "";
    let description = this.initial?.description || "";

    new Setting(contentEl)
      .setName("Block name")
      .addText((text) => {
        text.setValue(name).onChange((value) => { name = value; });
      });

    new Setting(contentEl)
      .setName("CSS selector")
      .addText((text) => {
        text.setValue(selector).onChange((value) => { selector = value; });
      });

    new Setting(contentEl)
      .setName("Description")
      .addText((text) => {
        text.setValue(description).onChange((value) => { description = value; });
      });

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText(this.initial ? "Save" : "Add")
          .setCta()
          .onClick(() => {
            this.close();
            this.onSubmit(name, selector, description);
          })
      );
  }

  onClose() {
    this.contentEl.empty();
  }
}
