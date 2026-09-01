<script setup lang="ts">
import { computed, ref } from "vue";
import type { WorkspaceFile } from "@vraxis/code-contracts";

interface TreeNode {
  name: string;
  path: string;
  directory: boolean;
  children: TreeNode[];
}

interface MutableTreeNode extends TreeNode {
  childIndex: Map<string, MutableTreeNode>;
  children: MutableTreeNode[];
}

interface TreeRow extends TreeNode {
  depth: number;
}

const props = defineProps<{
  files: WorkspaceFile[];
  selected: string;
}>();

const emit = defineEmits<{
  select: [path: string];
}>();

const query = ref("");
const collapsed = ref(new Set<string>());

const roots = computed(() => {
  const root: MutableTreeNode = { name: "", path: "", directory: true, children: [], childIndex: new Map() };
  for (const file of props.files) {
    const parts = file.path.split("/").filter(Boolean);
    let parent = root;
    let path = "";
    parts.forEach((name, index) => {
      path = path ? `${path}/${name}` : name;
      let node = parent.childIndex.get(name);
      if (!node) {
        node = { name, path, directory: index < parts.length - 1, children: [], childIndex: new Map() };
        parent.childIndex.set(name, node);
        parent.children.push(node);
      }
      parent = node;
    });
  }
  const sort = (nodes: TreeNode[]): void => {
    nodes.sort((left, right) => Number(right.directory) - Number(left.directory) || left.name.localeCompare(right.name));
    nodes.forEach((node) => sort(node.children));
  };
  sort(root.children);
  return root.children;
});

const rows = computed(() => {
  const result: TreeRow[] = [];
  const needle = query.value.trim().toLowerCase();
  const matchingPaths = new Set<string>();
  const collectMatches = (node: TreeNode): boolean => {
    const childMatches = node.children.some(collectMatches);
    const matches = node.path.toLowerCase().includes(needle) || childMatches;
    if (matches) matchingPaths.add(node.path);
    return matches;
  };
  if (needle) roots.value.forEach(collectMatches);
  const walk = (nodes: TreeNode[], depth: number): void => {
    for (const node of nodes) {
      if (needle && !matchingPaths.has(node.path)) continue;
      result.push({ ...node, depth });
      if (node.directory && (needle || !collapsed.value.has(node.path))) walk(node.children, depth + 1);
    }
  };
  walk(roots.value, 0);
  return result;
});

const statuses = computed(() => Object.fromEntries(
  props.files.filter((file) => file.status).map((file) => [file.path, file.status]),
));

function activate(row: TreeRow): void {
  if (!row.directory) {
    emit("select", row.path);
    return;
  }
  const next = new Set(collapsed.value);
  if (next.has(row.path)) next.delete(row.path);
  else next.add(row.path);
  collapsed.value = next;
}

function move(event: KeyboardEvent, row: TreeRow, index: number): void {
  if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  if (event.key === "ArrowRight" && row.directory && collapsed.value.has(row.path)) {
    activate(row);
    return;
  }
  if (event.key === "ArrowLeft" && row.directory && !collapsed.value.has(row.path)) {
    activate(row);
    return;
  }
  const buttons = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>("[role=\"treeitem\"]");
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? rows.value.length - 1
      : event.key === "ArrowDown"
        ? Math.min(index + 1, rows.value.length - 1)
        : event.key === "ArrowUp"
          ? Math.max(index - 1, 0)
          : index;
  buttons?.[nextIndex]?.focus();
}
</script>

<template>
  <section class="workspace-file-tree" aria-label="Project files">
    <label v-if="files.length > 12" class="tree-filter">
      <osx-icon name="search" :size="15" />
      <span class="visually-hidden">Filter files</span>
      <input v-model="query" type="search" placeholder="Filter files">
    </label>

    <div class="tree-rows" role="tree" aria-label="Project files">
      <button
        v-for="(row, index) in rows"
        :key="row.path"
        type="button"
        role="treeitem"
        :class="['tree-row', { selected: !row.directory && row.path === selected }]"
        :style="{ '--tree-depth': row.depth }"
        :aria-level="row.depth + 1"
        :aria-expanded="row.directory ? !collapsed.has(row.path) : undefined"
        :aria-selected="row.directory ? undefined : row.path === selected"
        :title="row.path"
        @click="activate(row)"
        @keydown="move($event, row, index)"
      >
        <osx-icon
          class="tree-disclosure"
          :name="row.directory ? collapsed.has(row.path) ? 'chevron-right' : 'chevron-down' : 'circle'"
          :size="row.directory ? 13 : 5"
        />
        <osx-icon
          class="tree-file-icon"
          :name="row.directory ? collapsed.has(row.path) ? 'folder' : 'folder-open' : 'file'"
          :size="16"
        />
        <span class="tree-name">{{ row.name }}</span>
        <span v-if="statuses[row.path]" :class="['tree-status', statuses[row.path]]">
          {{ statuses[row.path]?.slice(0, 1).toUpperCase() }}
        </span>
      </button>
      <p v-if="rows.length === 0">No matching files</p>
    </div>
  </section>
</template>
