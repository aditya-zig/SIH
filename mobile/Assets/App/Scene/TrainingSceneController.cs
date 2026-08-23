using System;
using System.Collections.Generic;
using SurakshaAR.Domain.Training;
using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;

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

        private ITrainingRuntime? runtime;
        private GameObject? anchorObject;

        public event Action<TrainingUpdate>? Updated;

        public bool IsPlaced => anchorObject != null;

        public void StartAttempt(ScenarioBundle scenario, AttemptContext context)
        {
            runtime = new TrainingRuntime();
            Updated?.Invoke(runtime.Begin(scenario, context));
        }

        public AttemptResult FinishAttempt()
        {
            return runtime?.Finish() ?? throw new InvalidOperationException("No training attempt is active.");
        }

        public void ResetScene()
        {
            if (anchorObject != null)
            {
                Destroy(anchorObject);
                anchorObject = null;
            }

            runtime = null;
            planeManager.enabled = true;
        }

        private void Update()
        {
            if (runtime == null || Input.touchCount != 1 || Input.GetTouch(0).phase != TouchPhase.Began)
            {
                return;
            }

            var screenPoint = Input.GetTouch(0).position;
            if (!IsPlaced)
            {
                TryPlaceScenario(screenPoint);
                return;
            }

            TryApplyTarget(screenPoint);
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

        private void TryApplyTarget(Vector2 screenPoint)
        {
            var ray = arCamera.ScreenPointToRay(screenPoint);
            if (!Physics.Raycast(ray, out var hit))
            {
                return;
            }

            var target = hit.collider.GetComponentInParent<TrainingTarget>();
            if (target == null || string.IsNullOrWhiteSpace(target.TargetId))
            {
                return;
            }

            Updated?.Invoke(runtime!.Apply(new TrainingAction(target.ActionKind, target.TargetId)));
        }
    }
}
