import { App } from "obsidian";
import { TaskNode, AIContextPayload } from "../types";
import { TaskService } from "./TaskService";
import TaskManagerPlugin from "../main";

export class TaskGraphService {
	private graph: Map<string, TaskNode> = new Map();

	constructor(private app: App, private plugin: TaskManagerPlugin, private taskService: TaskService) {}

	/**
	 * Scan all markdown task nodes in vault and refresh the in-memory graph
	 */
	refreshGraph(): Map<string, TaskNode> {
		this.graph.clear();
		const nodes = this.taskService.getAllTaskNodes();
		for (const node of nodes) {
			this.graph.set(node.id, node);
		}
		return this.graph;
	}

	/**
	 * Get the current in-memory graph map
	 */
	getGraph(): Map<string, TaskNode> {
		return this.graph;
	}

	/**
	 * Find node by ID from in-memory graph
	 */
	getNode(id: string): TaskNode | undefined {
		return this.graph.get(id);
	}

	/**
	 * Recursively trace parentId up to Root (Goal) node.
	 * Returns array ordered from Root -> Parent (excluding selected node itself).
	 */
	getAncestors(nodeId: string): TaskNode[] {
		const ancestors: TaskNode[] = [];
		let current = this.graph.get(nodeId);

		const visited = new Set<string>();
		if (current) visited.add(current.id);

		while (current && current.parentId) {
			if (visited.has(current.parentId)) {
				// Prevent infinite cycles
				break;
			}

			const parent = this.graph.get(current.parentId);
			if (!parent) break;

			ancestors.unshift(parent); // Prepend to preserve Root -> Parent hierarchy order
			visited.add(parent.id);
			current = parent;
		}

		return ancestors;
	}

	/**
	 * Get direct children of a specific node
	 */
	getChildren(nodeId: string): TaskNode[] {
		const children: TaskNode[] = [];
		for (const node of this.graph.values()) {
			if (node.parentId === nodeId) {
				children.push(node);
			}
		}
		return children;
	}

	/**
	 * Get sibling nodes sharing the same parentId
	 */
	getSiblings(nodeId: string): TaskNode[] {
		const node = this.graph.get(nodeId);
		if (!node || !node.parentId) return [];

		const siblings: TaskNode[] = [];
		for (const n of this.graph.values()) {
			if (n.parentId === node.parentId && n.id !== nodeId) {
				siblings.push(n);
			}
		}
		return siblings;
	}

	/**
	 * Build AI Context Payload: Extracts ancestors, direct children, and sibling strategies
	 * for prompt context building (前裁き).
	 */
	buildAIContext(selectedNodeId: string): AIContextPayload | null {
		this.refreshGraph();
		const selectedNode = this.graph.get(selectedNodeId);
		if (!selectedNode) return null;

		const ancestors = this.getAncestors(selectedNodeId);
		const children = this.getChildren(selectedNodeId);

		let siblingStrategies: TaskNode[] = [];

		if (selectedNode.nodeType === "strategy") {
			siblingStrategies = this.getSiblings(selectedNodeId).filter(
				(n) => n.nodeType === "strategy"
			);
		} else if (selectedNode.nodeType === "action" && ancestors.length > 0) {
			const strategyAncestor = ancestors.find((a) => a.nodeType === "strategy");
			if (strategyAncestor && strategyAncestor.parentId) {
				siblingStrategies = this.getChildren(strategyAncestor.parentId).filter(
					(n) => n.nodeType === "strategy" && n.id !== strategyAncestor.id
				);
			}
		} else if (selectedNode.nodeType === "goal") {
			siblingStrategies = children.filter((n) => n.nodeType === "strategy");
		}

		return {
			selectedNode,
			ancestors,
			children,
			siblingStrategies,
		};
	}
}
