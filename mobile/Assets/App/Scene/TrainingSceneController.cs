using System;
using System.Collections.Generic;
using System.Linq;
using SurakshaAR.Domain.Training;
using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;

#nullable enable

namespace SurakshaAR.Scene
{
    [DisallowMultipleComponent]
    public sealed class TrainingSceneController : MonoBehaviour
    {
        private static readonly List<ARRaycastHit> ArHits = new List<ARRaycastHit>();

        [SerializeField]
        private ARRaycastManager raycastManager = null!;

        [SerializeField]
        private ARPlaneManager planeManager = null!;

        [SerializeField]
        private Camera arCamera = null!;

        [SerializeField]
        private GameObject scenarioPrefab = null!;

        private MobileTrainingSession? session;
        private ScenarioBundle? scenario;
        private GameObject? anchorObject;
        private float holdStartTime;
        private bool isHolding;
        private string? holdInteractionId;
        private string? holdTargetId;

        public event Action<TrainingUpdate>? Updated;

        public bool IsPlaced => anchorObject != null;

        public void StartAttempt(ScenarioBundle bundle, AttemptContext context)
        {
            scenario = bundle ?? throw new ArgumentNullException(nameof(bundle));
            session = new MobileTrainingSession(new[] { bundle });
            var update = session.SelectModule(bundle.Id, context);
            Updated?.Invoke(update.Training);
        }

        public AttemptResult FinishAttempt()
        {
            return session?.CompletedAttempt ?? throw new InvalidOperationException("No training attempt is active.");
        }

        public void ResetScene()
        {
            if (anchorObject != null)
            {
                Destroy(anchorObject);
                anchorObject = null;
            }

            session = null;
            scenario = null;
            isHolding = false;
            holdInteractionId = null;
            holdTargetId = null;
            planeManager.enabled = true;
        }

        private void Update()
        {
            if (session == null || scenario == null)
            {
                return;
            }

            if (!IsPlaced)
            {
                if (Input.touchCount == 1 && Input.GetTouch(0).phase == TouchPhase.Began)
                {
                    TryPlaceScenario(Input.GetTouch(0).position);
                }
                return;
            }

            CheckWaypointArrival();
            CheckZoneEntryExit();
            HandleHoldInput();
            HandleTapInput();
        }

        private void TryPlaceScenario(Vector2 screenPoint)
        {
            if (!raycastManager.Raycast(screenPoint, ArHits, TrackableType.PlaneWithinPolygon))
            {
                return;
            }

            var pose = ArHits[0].pose;
            anchorObject = new GameObject("TrainingScenarioAnchor");
            anchorObject.transform.SetPositionAndRotation(pose.position, pose.rotation);
            anchorObject.AddComponent<ARAnchor>();
            Instantiate(scenarioPrefab, anchorObject.transform);
            planeManager.enabled = false;
        }

        private void HandleTapInput()
        {
            if (Input.touchCount != 1)
            {
                return;
            }

            var touch = Input.GetTouch(0);
            if (touch.phase != TouchPhase.Began)
            {
                return;
            }

            var ray = arCamera.ScreenPointToRay(touch.position);
            if (!Physics.Raycast(ray, out var hit))
            {
                return;
            }

            var target = hit.collider.GetComponentInParent<TrainingTarget>();
            if (target == null || string.IsNullOrWhiteSpace(target.InteractionId))
            {
                return;
            }

            var definition = scenario!.Interactions.SingleOrDefault(d => d.Id == target.InteractionId);
            if (definition == null)
            {
                return;
            }

            if (definition.Kind == SemanticInteractionKind.CompletedHold)
            {
                isHolding = true;
                holdStartTime = Time.time;
                holdInteractionId = definition.Id;
                holdTargetId = definition.TargetId;
                return;
            }

            if (definition.Kind == SemanticInteractionKind.WaypointArrived
                || definition.Kind == SemanticInteractionKind.ZoneEntered
                || definition.Kind == SemanticInteractionKind.ZoneExited)
            {
                return;
            }

            var interaction = new SemanticInteraction(definition.Id, definition.Kind, definition.TargetId);
            var update = session!.Apply(interaction);
            Updated?.Invoke(update.Training);
            if (update.ReturnedToLauncher)
            {
                ResetScene();
            }
        }

        private void HandleHoldInput()
        {
            if (!isHolding || holdInteractionId == null || holdTargetId == null)
            {
                return;
            }

            if (Input.touchCount != 1)
            {
                var duration = Time.time - holdStartTime;
                isHolding = false;
                var kind = SemanticInteractionKind.InterruptedHold;
                var holdInteraction = new SemanticInteraction(holdInteractionId, kind, holdTargetId);
                var holdUpdate = session!.Apply(holdInteraction);
                Updated?.Invoke(holdUpdate.Training);
                if (holdUpdate.ReturnedToLauncher)
                {
                    ResetScene();
                }
                return;
            }

            var t = Input.GetTouch(0);
            if (t.phase == TouchPhase.Ended || t.phase == TouchPhase.Canceled)
            {
                var holdDuration = Time.time - holdStartTime;
                isHolding = false;
                var holdKind = SemanticInteractionKind.CompletedHold;
                var interaction = new SemanticInteraction(holdInteractionId, holdKind, holdTargetId, (decimal)holdDuration);
                var update = session!.Apply(interaction);
                Updated?.Invoke(update.Training);
                if (update.ReturnedToLauncher)
                {
                    ResetScene();
                }
            }
        }

        private void CheckWaypointArrival()
        {
            if (anchorObject == null || scenario == null)
            {
                return;
            }

            var waypointDefinitions = scenario.Interactions.Where(d => d.Kind == SemanticInteractionKind.WaypointArrived).ToArray();
            if (waypointDefinitions.Length == 0)
            {
                return;
            }

            foreach (var definition in waypointDefinitions)
            {
                var targetObject = anchorObject.GetComponentsInChildren<TrainingTarget>()
                    .FirstOrDefault(t => t.InteractionId == definition.Id);
                if (targetObject == null)
                {
                    continue;
                }

                var distance = Vector3.Distance(arCamera.transform.position, targetObject.transform.position);
                if (distance > 0.8f)
                {
                    continue;
                }

                var nextWaypoint = definition.OrderedWaypoints.FirstOrDefault();
                if (string.IsNullOrWhiteSpace(nextWaypoint))
                {
                    continue;
                }

                var interaction = new SemanticInteraction(definition.Id, SemanticInteractionKind.WaypointArrived, nextWaypoint);
                var update = session!.Apply(interaction);
                Updated?.Invoke(update.Training);
                if (update.ReturnedToLauncher)
                {
                    ResetScene();
                }
                break;
            }
        }

        private void CheckZoneEntryExit()
        {
            if (anchorObject == null || scenario == null)
            {
                return;
            }

            var zoneDefinitions = scenario.Interactions
                .Where(d => d.Kind == SemanticInteractionKind.ZoneEntered || d.Kind == SemanticInteractionKind.ZoneExited)
                .ToArray();
            if (zoneDefinitions.Length == 0)
            {
                return;
            }

            foreach (var definition in zoneDefinitions)
            {
                var targetObject = anchorObject.GetComponentsInChildren<TrainingTarget>()
                    .FirstOrDefault(t => t.InteractionId == definition.Id);
                if (targetObject == null)
                {
                    continue;
                }

                var distance = Vector3.Distance(arCamera.transform.position, targetObject.transform.position);
                if (distance > 0.8f)
                {
                    continue;
                }

                var interaction = new SemanticInteraction(definition.Id, definition.Kind, definition.TargetId);
                var update = session!.Apply(interaction);
                Updated?.Invoke(update.Training);
                if (update.ReturnedToLauncher)
                {
                    ResetScene();
                }
                break;
            }
        }
    }
}
