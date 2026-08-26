using UnityEngine;
using UnityEngine.SceneManagement;

namespace SurakshaAR.Application
{
    public sealed class NavigationController : MonoBehaviour
    {
        private static NavigationController? instance;

        private void Awake()
        {
            if (instance == null)
            {
                instance = this;
                DontDestroyOnLoad(gameObject);
            }
            else
            {
                Destroy(gameObject);
            }
        }

        public void GoToMainMenu() => SceneManager.LoadScene("MainMenu");
        public void GoToTraining(string scenarioType) => SceneManager.LoadScene(scenarioType + "Training");
        public void GoToDashboard() => SceneManager.LoadScene("Dashboard");
        public void GoToSettings() => SceneManager.LoadScene("Settings");
        public void GoToLogin() => SceneManager.LoadScene("LoginMenu");

        public static NavigationController Instance => instance ?? throw new System.InvalidOperationException("NavigationController not initialized.");
    }
}
