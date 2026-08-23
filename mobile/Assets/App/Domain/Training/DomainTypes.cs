using System;
using System.Collections.Generic;
using System.Linq;

namespace SurakshaAR.Domain.Training
{
    public enum ActionOutcome
    {
        Accepted,
        Penalized,
        Rejected,
    }

    public sealed class TrainingAction
    {
        public TrainingAction(string kind, string targetId, IReadOnlyDictionary<string, string>? data = null)
        {
            Kind = RequireText(kind, nameof(kind));
            TargetId = RequireText(targetId, nameof(targetId));
            Data = data;
        }

        public string Kind { get; }

        public string TargetId { get; }

        public IReadOnlyDictionary<string, string>? Data { get; }

        internal static string RequireText(string value, string parameterName)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                throw new ArgumentException("A value is required.", parameterName);
            }

            return value;
        }
    }

    public sealed class AcceptedAction
    {
        public AcceptedAction(string kind, string targetId)
        {
            Kind = TrainingAction.RequireText(kind, nameof(kind));
            TargetId = TrainingAction.RequireText(targetId, nameof(targetId));
        }

        public string Kind { get; }

        public string TargetId { get; }

        internal bool Matches(TrainingAction action)
        {
            return string.Equals(Kind, action.Kind, StringComparison.Ordinal)
                && string.Equals(TargetId, action.TargetId, StringComparison.Ordinal);
        }
    }

    public sealed class WrongAction
    {
        public WrongAction(string kind, string targetId, int penalty, bool critical)
        {
            if (penalty < 0)
            {
                throw new ArgumentOutOfRangeException(nameof(penalty));
            }

            Kind = TrainingAction.RequireText(kind, nameof(kind));
            TargetId = TrainingAction.RequireText(targetId, nameof(targetId));
            Penalty = penalty;
            Critical = critical;
        }

        public string Kind { get; }

        public string TargetId { get; }

        public int Penalty { get; }

        public bool Critical { get; }

        internal bool Matches(TrainingAction action)
        {
            return string.Equals(Kind, action.Kind, StringComparison.Ordinal)
                && string.Equals(TargetId, action.TargetId, StringComparison.Ordinal);
        }
    }

    public sealed class ScenarioStep
    {
        public ScenarioStep(
            string id,
            int score,
            IReadOnlyList<AcceptedAction> acceptedActions,
            IReadOnlyList<WrongAction> wrongActions,
            string? cueKey = null)
        {
            if (score < 0)
            {
                throw new ArgumentOutOfRangeException(nameof(score));
            }

            Id = TrainingAction.RequireText(id, nameof(id));
            Score = score;
            AcceptedActions = acceptedActions ?? throw new ArgumentNullException(nameof(acceptedActions));
            WrongActions = wrongActions ?? throw new ArgumentNullException(nameof(wrongActions));
            CueKey = cueKey;

            if (AcceptedActions.Count == 0)
            {
                throw new ArgumentException("A scenario step needs an accepted action.", nameof(acceptedActions));
            }
        }

        public string Id { get; }

        public int Score { get; }

        public IReadOnlyList<AcceptedAction> AcceptedActions { get; }

        public IReadOnlyList<WrongAction> WrongActions { get; }

        public string? CueKey { get; }
    }

    public sealed class ScenarioBundle
    {
        public ScenarioBundle(string id, int version, int passScore, IReadOnlyList<ScenarioStep> steps)
        {
            if (version < 1)
            {
                throw new ArgumentOutOfRangeException(nameof(version));
            }

            if (passScore < 0)
            {
                throw new ArgumentOutOfRangeException(nameof(passScore));
            }

            Id = TrainingAction.RequireText(id, nameof(id));
            Version = version;
            PassScore = passScore;
            Steps = steps ?? throw new ArgumentNullException(nameof(steps));

            if (Steps.Count == 0)
            {
                throw new ArgumentException("A scenario needs at least one step.", nameof(steps));
            }

            if (Steps.Select(step => step.Id).Distinct(StringComparer.Ordinal).Count() != Steps.Count)
            {
                throw new ArgumentException("Scenario step ids must be unique.", nameof(steps));
            }
        }

        public string Id { get; }

        public int Version { get; }

        public int PassScore { get; }

        public IReadOnlyList<ScenarioStep> Steps { get; }
    }

    public sealed class AttemptContext
    {
        public AttemptContext(Guid attemptId, string workerId, string deviceId, DateTimeOffset startedAt)
        {
            if (attemptId == Guid.Empty)
            {
                throw new ArgumentException("Attempt id cannot be empty.", nameof(attemptId));
            }

            AttemptId = attemptId;
            WorkerId = TrainingAction.RequireText(workerId, nameof(workerId));
            DeviceId = TrainingAction.RequireText(deviceId, nameof(deviceId));
            StartedAt = startedAt;
        }

        public Guid AttemptId { get; }

        public string WorkerId { get; }

        public string DeviceId { get; }

        public DateTimeOffset StartedAt { get; }
    }

    public sealed class TrainingState
    {
        public TrainingState(string stepId, bool completed)
        {
            StepId = stepId;
            Completed = completed;
        }

        public string StepId { get; }

        public bool Completed { get; }
    }

    public sealed class AttemptEvent : IEquatable<AttemptEvent>
    {
        public AttemptEvent(
            int sequence,
            string stepId,
            TrainingAction action,
            ActionOutcome outcome,
            int scoreDelta,
            bool critical)
        {
            Sequence = sequence;
            StepId = stepId;
            Action = action;
            Outcome = outcome;
            ScoreDelta = scoreDelta;
            Critical = critical;
        }

        public int Sequence { get; }

        public string StepId { get; }

        public TrainingAction Action { get; }

        public ActionOutcome Outcome { get; }

        public int ScoreDelta { get; }

        public bool Critical { get; }

        public bool Equals(AttemptEvent? other)
        {
            return other != null
                && Sequence == other.Sequence
                && StepId == other.StepId
                && Action.Kind == other.Action.Kind
                && Action.TargetId == other.Action.TargetId
                && Outcome == other.Outcome
                && ScoreDelta == other.ScoreDelta
                && Critical == other.Critical;
        }

        public override bool Equals(object? obj) => Equals(obj as AttemptEvent);

        public override int GetHashCode() => Sequence;
    }

    public sealed class TrainingUpdate
    {
        public TrainingUpdate(
            TrainingState state,
            string? cueKey,
            int score,
            bool criticalFailure,
            IReadOnlyList<AttemptEvent> newEvents)
        {
            State = state;
            CueKey = cueKey;
            Score = score;
            CriticalFailure = criticalFailure;
            NewEvents = newEvents;
        }

        public TrainingState State { get; }

        public string? CueKey { get; }

        public int Score { get; }

        public bool CriticalFailure { get; }

        public IReadOnlyList<AttemptEvent> NewEvents { get; }
    }

    public sealed class AttemptResult : IEquatable<AttemptResult>
    {
        public AttemptResult(
            Guid attemptId,
            string workerId,
            string deviceId,
            string moduleId,
            int moduleVersion,
            DateTimeOffset startedAt,
            int score,
            bool passed,
            bool criticalFailure,
            IReadOnlyList<AttemptEvent> events)
        {
            AttemptId = attemptId;
            WorkerId = workerId;
            DeviceId = deviceId;
            ModuleId = moduleId;
            ModuleVersion = moduleVersion;
            StartedAt = startedAt;
            Score = score;
            Passed = passed;
            CriticalFailure = criticalFailure;
            Events = events;
        }

        public Guid AttemptId { get; }

        public string WorkerId { get; }

        public string DeviceId { get; }

        public string ModuleId { get; }

        public int ModuleVersion { get; }

        public DateTimeOffset StartedAt { get; }

        public int Score { get; }

        public bool Passed { get; }

        public bool CriticalFailure { get; }

        public IReadOnlyList<AttemptEvent> Events { get; }

        public bool Equals(AttemptResult? other)
        {
            return other != null
                && AttemptId == other.AttemptId
                && WorkerId == other.WorkerId
                && DeviceId == other.DeviceId
                && ModuleId == other.ModuleId
                && ModuleVersion == other.ModuleVersion
                && StartedAt == other.StartedAt
                && Score == other.Score
                && Passed == other.Passed
                && CriticalFailure == other.CriticalFailure
                && Events.SequenceEqual(other.Events);
        }

        public override bool Equals(object? obj) => Equals(obj as AttemptResult);

        public override int GetHashCode() => AttemptId.GetHashCode();
    }
}
