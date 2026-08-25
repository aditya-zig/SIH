using UnityEngine;

namespace SurakshaAR.Application
{
    public sealed class TrainingUIBridge : MonoBehaviour
    {
        public void OnScenarioStarted(string scenarioId) => Debug.Log("Scenario started: " + scenarioId);
        public void OnChapterCompleted(int chapterNum) => Debug.Log("Chapter completed: " + chapterNum);
        public void UpdateProgress(float percent) => Debug.Log("Progress: " + percent);
        public void ShowMessage(string message) => Debug.Log("Message: " + message);
    }
}
