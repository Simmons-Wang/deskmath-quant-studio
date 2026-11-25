"use client";

import React, { useEffect, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import type { DrillConfig } from "@/lib/math";
import { attachValidationSync } from "@/lib/client/validation";
import { NativeDialog } from "./NativeDialog";

interface CustomRangeModalProps {
  open: boolean;
  onClose: () => void;
  config: DrillConfig;
  onApply: (next: DrillConfig) => void;
}

export function CustomRangeModal({
  open,
  onClose,
  config,
  onApply,
}: CustomRangeModalProps) {
  return (
    <NativeDialog
      open={open}
      onClose={onClose}
      titleId="custom-range-title"
      title="Customize Operand Ranges & Timer"
      wide
    >
      <CustomRangeForm
        key={`${String(open)}-${config.preset}-${config.questionCount}-${config.durationSec}`}
        config={config}
        onApply={(next) => {
          onApply(next);
          onClose();
        }}
        onCancel={onClose}
      />
    </NativeDialog>
  );
}

function CustomRangeForm({
  config,
  onApply,
  onCancel,
}: {
  config: DrillConfig;
  onApply: (next: DrillConfig) => void;
  onCancel: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [format, setFormat] = useState<DrillConfig["format"]>(config.format);
  const [durationSec, setDurationSec] = useState(String(config.durationSec));
  const [questionCount, setQuestionCount] = useState(String(config.questionCount));

  const [addMinA, setAddMinA] = useState(String(config.ranges.add.minA));
  const [addMaxA, setAddMaxA] = useState(String(config.ranges.add.maxA));
  const [addMinB, setAddMinB] = useState(String(config.ranges.add.minB));
  const [addMaxB, setAddMaxB] = useState(String(config.ranges.add.maxB));

  const [mulMinA, setMulMinA] = useState(String(config.ranges.mul.minA));
  const [mulMaxA, setMulMaxA] = useState(String(config.ranges.mul.maxA));
  const [mulMinB, setMulMinB] = useState(String(config.ranges.mul.minB));
  const [mulMaxB, setMulMaxB] = useState(String(config.ranges.mul.maxB));

  const [divMinD, setDivMinD] = useState(String(config.ranges.div.minDivisor));
  const [divMaxD, setDivMaxD] = useState(String(config.ranges.div.maxDivisor));
  const [divMinQ, setDivMinQ] = useState(String(config.ranges.div.minQuotient));
  const [divMaxQ, setDivMaxQ] = useState(String(config.ranges.div.maxQuotient));

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    return attachValidationSync(form);
  }, []);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    if (!form.checkValidity()) {
      const firstInvalid = form.querySelector<HTMLElement>(":invalid");
      firstInvalid?.focus();
      return;
    }

    onApply({
      ...config,
      preset: "custom",
      format,
      durationSec: Math.min(600, Math.max(15, Number.parseInt(durationSec, 10) || 120)),
      questionCount: Math.min(200, Math.max(5, Number.parseInt(questionCount, 10) || 25)),
      ranges: {
        ...config.ranges,
        add: {
          minA: Number.parseInt(addMinA, 10),
          maxA: Number.parseInt(addMaxA, 10),
          minB: Number.parseInt(addMinB, 10),
          maxB: Number.parseInt(addMaxB, 10),
        },
        mul: {
          minA: Number.parseInt(mulMinA, 10),
          maxA: Number.parseInt(mulMaxA, 10),
          minB: Number.parseInt(mulMinB, 10),
          maxB: Number.parseInt(mulMaxB, 10),
        },
        div: {
          minDivisor: Math.max(2, Number.parseInt(divMinD, 10)),
          maxDivisor: Math.max(2, Number.parseInt(divMaxD, 10)),
          minQuotient: Math.max(2, Number.parseInt(divMinQ, 10)),
          maxQuotient: Math.max(2, Number.parseInt(divMaxQ, 10)),
        },
      },
    });
  };

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate={false} className="stack-lg">
      <div className="dialog-review-grid">
        <div className="panel-subtle stack-lg" style={{ gap: "0.7rem" }}>
          <strong style={{ fontSize: "0.9rem" }}>Drill Format &amp; Length</strong>
          <div className="field">
            <label htmlFor="rng-format">Format</label>
            <select
              id="rng-format"
              className="select"
              value={format}
              onChange={(e) => setFormat(e.target.value as DrillConfig["format"])}
            >
              <option value="fixed">Fixed Question Count</option>
              <option value="timed">Timed Sprint (Seconds)</option>
              <option value="endless">Endless Flow</option>
            </select>
          </div>

          {format === "timed" && (
            <div className="field">
              <label htmlFor="rng-dur">Duration (15–600 seconds)</label>
              <span id="rng-dur-hint" className="hint">
                Positive integer between 15 and 600.
              </span>
              <input
                id="rng-dur"
                className="input mono"
                type="text"
                inputMode="numeric"
                required
                pattern="^(?:[1-9][5-9]|[2-9][0-9]|[1-5][0-9]{2}|600)$"
                aria-describedby="rng-dur-hint"
                data-error="rng-dur-err"
                value={durationSec}
                onChange={(e) => setDurationSec(e.target.value)}
              />
              <div id="rng-dur-err" className="field-error-msg">
                <AlertCircle size={14} aria-hidden="true" />
                <span>Error: Enter a duration between 15 and 600 seconds.</span>
              </div>
            </div>
          )}

          {format === "fixed" && (
            <div className="field">
              <label htmlFor="rng-qcount">Question Count (5–200)</label>
              <span id="rng-qcount-hint" className="hint">
                Integer count from 5 to 200 problems.
              </span>
              <input
                id="rng-qcount"
                className="input mono"
                type="text"
                inputMode="numeric"
                required
                pattern="^(?:[5-9]|[1-9][0-9]|1[0-9]{2}|200)$"
                aria-describedby="rng-qcount-hint"
                data-error="rng-qcount-err"
                value={questionCount}
                onChange={(e) => setQuestionCount(e.target.value)}
              />
              <div id="rng-qcount-err" className="field-error-msg">
                <AlertCircle size={14} aria-hidden="true" />
                <span>Error: Enter a question count between 5 and 200.</span>
              </div>
            </div>
          )}
        </div>

        <div className="panel-subtle stack-lg" style={{ gap: "0.7rem" }}>
          <strong style={{ fontSize: "0.9rem" }}>Addition (+) Integer Bounds</strong>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
            <div className="field">
              <label htmlFor="add-min-a">Left Min</label>
              <input
                id="add-min-a"
                className="input mono"
                type="text"
                inputMode="numeric"
                required
                pattern="^[1-9][0-9]{0,4}$"
                data-error="add-min-a-err"
                value={addMinA}
                onChange={(e) => setAddMinA(e.target.value)}
              />
              <div id="add-min-a-err" className="field-error-msg">
                <span>Error: Positive integer required.</span>
              </div>
            </div>
            <div className="field">
              <label htmlFor="add-max-a">Left Max</label>
              <input
                id="add-max-a"
                className="input mono"
                type="text"
                inputMode="numeric"
                required
                pattern="^[1-9][0-9]{0,4}$"
                data-error="add-max-a-err"
                value={addMaxA}
                onChange={(e) => setAddMaxA(e.target.value)}
              />
              <div id="add-max-a-err" className="field-error-msg">
                <span>Error: Positive integer required.</span>
              </div>
            </div>
            <div className="field">
              <label htmlFor="add-min-b">Right Min</label>
              <input
                id="add-min-b"
                className="input mono"
                type="text"
                inputMode="numeric"
                required
                pattern="^[1-9][0-9]{0,4}$"
                value={addMinB}
                onChange={(e) => setAddMinB(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="add-max-b">Right Max</label>
              <input
                id="add-max-b"
                className="input mono"
                type="text"
                inputMode="numeric"
                required
                pattern="^[1-9][0-9]{0,4}$"
                value={addMaxB}
                onChange={(e) => setAddMaxB(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="panel-subtle stack-lg" style={{ gap: "0.7rem" }}>
          <strong style={{ fontSize: "0.9rem" }}>Multiplication (×) Bounds</strong>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
            <div className="field">
              <label htmlFor="mul-min-a">Factor A Min</label>
              <input
                id="mul-min-a"
                className="input mono"
                type="text"
                inputMode="numeric"
                required
                pattern="^[2-9]|[1-9][0-9]{1,3}$"
                value={mulMinA}
                onChange={(e) => setMulMinA(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="mul-max-a">Factor A Max</label>
              <input
                id="mul-max-a"
                className="input mono"
                type="text"
                inputMode="numeric"
                required
                pattern="^[2-9]|[1-9][0-9]{1,3}$"
                value={mulMaxA}
                onChange={(e) => setMulMaxA(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="mul-min-b">Factor B Min</label>
              <input
                id="mul-min-b"
                className="input mono"
                type="text"
                inputMode="numeric"
                required
                pattern="^[2-9]|[1-9][0-9]{1,3}$"
                value={mulMinB}
                onChange={(e) => setMulMinB(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="mul-max-b">Factor B Max</label>
              <input
                id="mul-max-b"
                className="input mono"
                type="text"
                inputMode="numeric"
                required
                pattern="^[2-9]|[1-9][0-9]{1,3}$"
                value={mulMaxB}
                onChange={(e) => setMulMaxB(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="panel-subtle stack-lg" style={{ gap: "0.7rem" }}>
          <strong style={{ fontSize: "0.9rem" }}>Exact Division (÷) Bounds</strong>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
            <div className="field">
              <label htmlFor="div-min-d">Divisor Min</label>
              <input
                id="div-min-d"
                className="input mono"
                type="text"
                inputMode="numeric"
                required
                pattern="^[2-9]|[1-9][0-9]{1,3}$"
                value={divMinD}
                onChange={(e) => setDivMinD(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="div-max-d">Divisor Max</label>
              <input
                id="div-max-d"
                className="input mono"
                type="text"
                inputMode="numeric"
                required
                pattern="^[2-9]|[1-9][0-9]{1,3}$"
                value={divMaxD}
                onChange={(e) => setDivMaxD(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="div-min-q">Quotient Min</label>
              <input
                id="div-min-q"
                className="input mono"
                type="text"
                inputMode="numeric"
                required
                pattern="^[2-9]|[1-9][0-9]{1,3}$"
                value={divMinQ}
                onChange={(e) => setDivMinQ(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="div-max-q">Quotient Max</label>
              <input
                id="div-max-q"
                className="input mono"
                type="text"
                inputMode="numeric"
                required
                pattern="^[2-9]|[1-9][0-9]{1,3}$"
                value={divMaxQ}
                onChange={(e) => setDivMaxQ(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="dialog-footer">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary">
          Apply Custom Ranges
        </button>
      </div>
    </form>
  );
}
