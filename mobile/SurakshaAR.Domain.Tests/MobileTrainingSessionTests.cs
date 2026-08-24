using NUnit.Framework;
using SurakshaAR.Domain.Training;

namespace SurakshaAR.Domain.Tests;

public sealed class MobileTrainingSessionTests
{
    [Test]
    public void Selecting_fire_module_starts_its_first_training_step()
    {
        var session = new MobileTrainingSession(new[] { FireScenario(), GasScenario() });

        var update = session.SelectModule("fire_001", Context());

        Assert.Multiple(() =>
        {
            Assert.That(update.ModuleId, Is.EqualTo("fire_001"));
            Assert.That(update.Training.State.StepId, Is.EqualTo("identify_hazard"));
            Assert.That(update.ReturnedToLauncher, Is.False);
        });
    }

    [Test]
    public void Interrupted_or_short_hold_does_not_advance_the_fire_session()
    {
        var session = new MobileTrainingSession(new[] { FireScenario() });
        session.SelectModule("fire_001", Context());
        session.Apply(new SemanticInteraction("identify", SemanticInteractionKind.TargetSelected, "hazard"));

        var shortHold = session.Apply(new SemanticInteraction("discharge", SemanticInteractionKind.CompletedHold, "extinguisher_handle", 2));
        var interruptedHold = session.Apply(new SemanticInteraction("discharge", SemanticInteractionKind.InterruptedHold, "extinguisher_handle"));

        Assert.Multiple(() =>
        {
            Assert.That(shortHold.Training.State.StepId, Is.EqualTo("discharge"));
            Assert.That(shortHold.Training.NewEvents.Single().Outcome, Is.EqualTo(ActionOutcome.Rejected));
            Assert.That(interruptedHold.Training.State.StepId, Is.EqualTo("discharge"));
            Assert.That(interruptedHold.Training.NewEvents.Single().Outcome, Is.EqualTo(ActionOutcome.Rejected));
        });
    }

    [Test]
    public void Ordered_waypoints_complete_fire_and_return_to_launcher()
    {
        var session = new MobileTrainingSession(new[] { FireScenario() });
        session.SelectModule("fire_001", Context());
        session.Apply(new SemanticInteraction("identify", SemanticInteractionKind.TargetSelected, "hazard"));
        session.Apply(new SemanticInteraction("discharge", SemanticInteractionKind.CompletedHold, "extinguisher_handle", 3));

        var firstWaypoint = session.Apply(new SemanticInteraction("exit_route", SemanticInteractionKind.WaypointArrived, "exit_a"));
        var completed = session.Apply(new SemanticInteraction("exit_route", SemanticInteractionKind.WaypointArrived, "exit_b"));

        Assert.Multiple(() =>
        {
            Assert.That(firstWaypoint.Training.State.StepId, Is.EqualTo("evacuate"));
            Assert.That(firstWaypoint.Training.NewEvents, Is.Empty);
            Assert.That(completed.ReturnedToLauncher, Is.True);
            Assert.That(completed.ModuleId, Is.Null);
            Assert.That(session.CompletedAttempt!.Passed, Is.True);
        });
    }

    [Test]
    public void Out_of_order_waypoint_records_rejection_without_advancing()
    {
        var session = new MobileTrainingSession(new[] { FireScenario() });
        session.SelectModule("fire_001", Context());
        session.Apply(new SemanticInteraction("identify", SemanticInteractionKind.TargetSelected, "hazard"));
        session.Apply(new SemanticInteraction("discharge", SemanticInteractionKind.CompletedHold, "extinguisher_handle", 3));

        var update = session.Apply(new SemanticInteraction("exit_route", SemanticInteractionKind.WaypointArrived, "exit_b"));

        Assert.Multiple(() =>
        {
            Assert.That(update.ReturnedToLauncher, Is.False);
            Assert.That(update.Training.State.StepId, Is.EqualTo("evacuate"));
            Assert.That(update.Training.NewEvents.Single().Outcome, Is.EqualTo(ActionOutcome.Rejected));
        });
    }

    [Test]
    public void Gas_session_accepts_zone_entry_and_exit_interactions()
    {
        var session = new MobileTrainingSession(new[] { GasScenario() });
        session.SelectModule("gas_001", Context());

        var entered = session.Apply(new SemanticInteraction("enter_hazard", SemanticInteractionKind.ZoneEntered, "methane_hazard_zone"));
        var exited = session.Apply(new SemanticInteraction("leave_hazard", SemanticInteractionKind.ZoneExited, "safe_zone"));

        Assert.Multiple(() =>
        {
            Assert.That(entered.Training.State.StepId, Is.EqualTo("withdraw"));
            Assert.That(exited.ReturnedToLauncher, Is.True);
            Assert.That(session.CompletedAttempt!.Passed, Is.True);
        });
    }

    [Test]
    public void Critical_semantic_interaction_marks_the_attempt_as_failed()
    {
        var session = new MobileTrainingSession(new[] { FireScenario() });
        session.SelectModule("fire_001", Context());

        var update = session.Apply(new SemanticInteraction("wrong_extinguisher", SemanticInteractionKind.TargetSelected, "water_extinguisher"));

        Assert.Multiple(() =>
        {
            Assert.That(update.Training.CriticalFailure, Is.True);
            Assert.That(update.Training.NewEvents.Single().Outcome, Is.EqualTo(ActionOutcome.Penalized));
            Assert.That(session.CompletedAttempt, Is.Null);
        });
    }

    [Test]
    public void Cannot_replace_an_active_attempt_with_another_module()
    {
        var session = new MobileTrainingSession(new[] { FireScenario(), GasScenario() });
        session.SelectModule("fire_001", Context());

        Assert.That(
            () => session.SelectModule("gas_001", Context()),
            Throws.InvalidOperationException.With.Message.EqualTo("Finish the active training attempt before selecting another module."));
    }

    private static AttemptContext Context()
    {
        return new AttemptContext(Guid.NewGuid(), "worker-1", "device-1", DateTimeOffset.Parse("2026-08-24T12:00:00Z"));
    }

    private static ScenarioBundle FireScenario()
    {
        return new ScenarioBundle(
            "fire_001",
            1,
            0,
            new[]
            {
                new ScenarioStep(
                    "identify_hazard",
                    0,
                    new[] { new AcceptedAction("select", "hazard") },
                    new[] { new WrongAction("select", "water_extinguisher", 0, true) }),
                new ScenarioStep("discharge", 0, new[] { new AcceptedAction("hold", "extinguisher_handle") }, Array.Empty<WrongAction>()),
                new ScenarioStep("evacuate", 0, new[] { new AcceptedAction("waypoint_sequence", "safe_exit") }, Array.Empty<WrongAction>()),
            },
            new ScenarioSceneReference("FireScene", "fire_prefab"),
            new[]
            {
                new ScenarioInteractionDefinition("identify", SemanticInteractionKind.TargetSelected, "select", "hazard"),
                new ScenarioInteractionDefinition("wrong_extinguisher", SemanticInteractionKind.TargetSelected, "select", "water_extinguisher"),
                new ScenarioInteractionDefinition("discharge", SemanticInteractionKind.CompletedHold, "hold", "extinguisher_handle", 3),
                new ScenarioInteractionDefinition("exit_route", SemanticInteractionKind.WaypointArrived, "waypoint_sequence", "safe_exit", orderedWaypoints: new[] { "exit_a", "exit_b" }),
            });
    }

    private static ScenarioBundle GasScenario()
    {
        return new ScenarioBundle(
            "gas_001",
            1,
            0,
            new[]
            {
                new ScenarioStep("recognize_hazard_zone", 0, new[] { new AcceptedAction("zone_enter", "methane_hazard_zone") }, Array.Empty<WrongAction>()),
                new ScenarioStep("withdraw", 0, new[] { new AcceptedAction("zone_exit", "safe_zone") }, Array.Empty<WrongAction>()),
            },
            new ScenarioSceneReference("GasScene", "gas_prefab"),
            new[]
            {
                new ScenarioInteractionDefinition("enter_hazard", SemanticInteractionKind.ZoneEntered, "zone_enter", "methane_hazard_zone"),
                new ScenarioInteractionDefinition("leave_hazard", SemanticInteractionKind.ZoneExited, "zone_exit", "safe_zone"),
            });
    }
}
