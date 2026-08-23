using NUnit.Framework;
using SurakshaAR.Infrastructure.Catalog;

namespace SurakshaAR.Infrastructure.Tests;

public sealed class JsonTrainingCatalogTests
{
    [Test]
    public async Task Loads_versioned_fire_scenario()
    {
        var directory = Path.GetFullPath(Path.Combine(
            TestContext.CurrentContext.TestDirectory,
            "../../../../Assets/StreamingAssets/Scenarios"));
        var catalog = new JsonTrainingCatalog(directory);

        var scenario = await catalog.Get("fire_001", 1);

        Assert.Multiple(() =>
        {
            Assert.That(scenario.Id, Is.EqualTo("fire_001"));
            Assert.That(scenario.Version, Is.EqualTo(1));
            Assert.That(scenario.PassScore, Is.EqualTo(70));
            Assert.That(scenario.Steps, Has.Count.EqualTo(6));
            Assert.That(scenario.Steps[1].WrongActions.Single().Critical, Is.True);
        });
    }
}
