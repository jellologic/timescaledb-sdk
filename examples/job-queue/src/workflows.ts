/**
 * Job Queue — Workflow Step Definitions
 *
 * Defines workflow steps for sequential and parallel orchestration.
 */
import type { WorkflowStep } from "../../../src/queue/types.js"

/** Sequential order processing — each step receives the previous result */
export const orderProcessingSteps: WorkflowStep[] = [
  {
    name: "validate-payment",
    queue: "orders",
    jobName: "validate-payment",
    data: { orderId: "ORD-001", amount: 99.99 },
  },
  {
    name: "reserve-inventory",
    queue: "orders",
    jobName: "reserve-inventory",
    data: (prev: any) => ({
      orderId: "ORD-001",
      paymentValidated: prev?.sent ?? true,
    }),
  },
  {
    name: "send-confirmation",
    queue: "orders",
    jobName: "send-confirmation",
    data: (prev: any) => ({
      orderId: "ORD-001",
      inventoryReserved: prev?.reserved ?? true,
    }),
  },
]

/** Parallel report generation — all steps run independently */
export const reportGenerationSteps: WorkflowStep[] = [
  {
    name: "sales-report",
    queue: "reports",
    jobName: "generate-sales-report",
    data: { period: "2024-Q1" },
  },
  {
    name: "inventory-report",
    queue: "reports",
    jobName: "generate-inventory-report",
    data: { period: "2024-Q1" },
  },
  {
    name: "customer-report",
    queue: "reports",
    jobName: "generate-customer-report",
    data: { period: "2024-Q1" },
  },
]
